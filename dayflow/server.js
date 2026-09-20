#!/usr/bin/env node

/**
 * DayFlow server.
 *
 * One zero-dependency Node process that serves:
 *   • the browser UI            GET  /
 *   • the task API              GET  /tasks, POST /add-task, /complete-task,
 *                               /update-task, /delete-task, /clear-completed
 *   • a live change stream      GET  /events   (Server-Sent Events)
 *   • a liveness probe          GET  /health
 *
 * The same API is what the MCP server in ./mcp talks to, so a task Claude
 * creates shows up on the board immediately and vice versa.
 *
 * Binds to loopback only. Tasks are personal data: nothing is exposed to the
 * network, no CORS headers are sent, and the Host header is checked so a
 * remote page cannot reach this server by DNS rebinding.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, defaultDataFile, SECTIONS, PRIORITIES, VIEWS } from "./lib/store.js";
import { parse, toISODate } from "./lib/parse.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "public");
const PORT = Number(process.env.DAYFLOW_PORT || 3001);
const HOST = process.env.DAYFLOW_HOST || "127.0.0.1";
const MAX_BODY = 64 * 1024;
const VERSION = "1.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

// ── Validation ───────────────────────────────────────────────────────────────

class BadRequest extends Error {}

const pick = (obj, ...names) => {
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null && obj[n] !== "") return obj[n];
  }
  return undefined;
};

function validDate(value) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value).trim());
  if (!m) throw new BadRequest(`Invalid date "${value}" — expected YYYY-MM-DD`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    throw new BadRequest(`Invalid date "${value}" — no such day`);
  }
  return toISODate(dt);
}

function validTime(value) {
  const raw = String(value).trim();
  let m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(raw);
  if (!m) m = /^(\d{1,2})()\s*(am|pm)$/i.exec(raw);
  if (!m) throw new BadRequest(`Invalid time "${value}" — expected HH:MM (24h)`);
  let hour = Number(m[1]);
  const minute = m[2] === "" ? 0 : Number(m[2]);
  const mer = (m[3] || "").toLowerCase();
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) throw new BadRequest(`Invalid time "${value}" — out of range`);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function oneOf(value, allowed, label) {
  const v = String(value).trim().toLowerCase();
  if (!allowed.includes(v)) {
    throw new BadRequest(`Invalid ${label} "${value}" — expected one of ${allowed.join(", ")}`);
  }
  return v;
}

function validTitle(value) {
  const title = String(value).trim().replace(/\s+/g, " ");
  if (!title) throw new BadRequest("Task title cannot be empty");
  if (title.length > 500) throw new BadRequest("Task title is too long (max 500 characters)");
  return title;
}

function validNotes(value) {
  const notes = String(value);
  if (notes.length > 10000) throw new BadRequest("Notes are too long (max 10000 characters)");
  return notes;
}

/** Build a complete task record from either `text` (parsed) or explicit fields. */
function buildTask(body) {
  const text = pick(body, "text", "input", "raw");
  const base = text
    ? parse(text)
    : { title: "", notes: "", section: "todo", view: "day", priority: "medium", dueDate: null, dueTime: null, owedBy: null, owedAmount: null };

  const title = pick(body, "title", "name");
  if (title !== undefined) base.title = validTitle(title);
  else if (text) base.title = validTitle(base.title);
  else throw new BadRequest("Provide either 'text' (natural language) or 'title'");

  const dueDate = pick(body, "due_date", "dueDate", "date");
  if (dueDate !== undefined) base.dueDate = validDate(dueDate);

  const dueTime = pick(body, "due_time", "dueTime", "time");
  if (dueTime !== undefined) base.dueTime = validTime(dueTime);

  const priority = pick(body, "priority");
  if (priority !== undefined) base.priority = oneOf(priority, PRIORITIES, "priority");

  const section = pick(body, "category", "section", "column");
  if (section !== undefined) base.section = oneOf(section, SECTIONS, "category");

  const view = pick(body, "view", "scope");
  if (view !== undefined) base.view = oneOf(view, VIEWS, "view");

  const notes = pick(body, "notes", "note", "description");
  if (notes !== undefined) base.notes = validNotes(notes);

  const owedBy = pick(body, "owed_by", "owedBy");
  if (owedBy !== undefined) base.owedBy = String(owedBy).trim().slice(0, 120);

  const owedAmount = pick(body, "owed_amount", "owedAmount", "amount");
  if (owedAmount !== undefined) base.owedAmount = String(owedAmount).trim().slice(0, 60);

  // An amount or a debtor without an explicit column clearly belongs in Owe Me.
  if ((base.owedBy || base.owedAmount) && section === undefined) base.section = "owe_me";

  base.source = body.source === "mcp" || body.source === "app" ? body.source : undefined;
  return base;
}

/** Only the fields a caller may change, validated the same way. */
function buildPatch(body) {
  const patch = {};
  if (body.title !== undefined) patch.title = validTitle(body.title);
  if (body.notes !== undefined) patch.notes = validNotes(body.notes);

  const dueDate = pick(body, "due_date", "dueDate", "date");
  if (dueDate !== undefined) patch.dueDate = validDate(dueDate);
  else if (body.due_date === null || body.dueDate === null) patch.dueDate = null;

  const dueTime = pick(body, "due_time", "dueTime", "time");
  if (dueTime !== undefined) patch.dueTime = validTime(dueTime);
  else if (body.due_time === null || body.dueTime === null) patch.dueTime = null;

  if (body.priority !== undefined) patch.priority = oneOf(body.priority, PRIORITIES, "priority");

  const section = pick(body, "category", "section");
  if (section !== undefined) patch.section = oneOf(section, SECTIONS, "category");

  if (body.view !== undefined) patch.view = oneOf(body.view, VIEWS, "view");

  const owedBy = pick(body, "owed_by", "owedBy");
  if (owedBy !== undefined) patch.owedBy = String(owedBy).trim().slice(0, 120);
  else if (body.owed_by === null || body.owedBy === null) patch.owedBy = null;

  const owedAmount = pick(body, "owed_amount", "owedAmount", "amount");
  if (owedAmount !== undefined) patch.owedAmount = String(owedAmount).trim().slice(0, 60);
  else if (body.owed_amount === null || body.owedAmount === null) patch.owedAmount = null;

  if (Object.keys(patch).length === 0) throw new BadRequest("Nothing to update");
  return patch;
}

function requireId(body) {
  const id = pick(body, "id", "task_id", "taskId");
  if (!id) throw new BadRequest("Missing 'id'");
  return String(id);
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new BadRequest("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return reject(new BadRequest("Request body must be a JSON object"));
        }
        resolve(parsed);
      } catch {
        reject(new BadRequest("Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Reject anything that isn't addressing us as localhost (DNS-rebind guard). */
function hostAllowed(req) {
  const host = (req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  return host === "" || host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { success: false, error: "Forbidden" });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { success: false, error: `Not found: ${pathname}` });
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

// ── Server ───────────────────────────────────────────────────────────────────

export function createServer(store = new Store()) {
  const clients = new Set();

  store.onChange((event) => {
    const payload = `event: change\ndata: ${JSON.stringify({ kind: event.kind, id: event.task?.id ?? null })}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  });

  const server = http.createServer(async (req, res) => {
    if (!hostAllowed(req)) return send(res, 403, { success: false, error: "Forbidden host" });

    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return send(res, 400, { success: false, error: "Bad request URL" });
    }
    const { pathname, searchParams } = url;
    const method = req.method || "GET";

    try {
      if (method === "OPTIONS") {
        res.writeHead(204, { Allow: "GET, POST, OPTIONS" });
        return res.end();
      }

      if (method === "GET" && pathname === "/health") {
        return send(res, 200, {
          success: true,
          ok: true,
          app: "dayflow",
          version: VERSION,
          dataFile: store.file,
          tasks: store.tasks.length,
          open: store.tasks.filter((t) => !t.completed).length,
        });
      }

      if (method === "GET" && pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        res.write("retry: 2000\n\n");
        clients.add(res);
        const ping = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch { /* cleaned up on close */ }
        }, 25000);
        ping.unref?.();
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return undefined;
      }

      if (method === "GET" && pathname === "/parse") {
        // Dry run of the natural-language parser, so the UI can preview what a
        // typed line will become before the task is created.
        const text = searchParams.get("text") || "";
        if (!text.trim()) return send(res, 200, { success: true, parsed: null });
        return send(res, 200, { success: true, parsed: parse(text) });
      }

      if (method === "GET" && (pathname === "/tasks" || pathname === "/get-tasks")) {
        const filter = {};
        for (const key of ["status", "section", "q", "view", "date", "from", "to"]) {
          const v = searchParams.get(key);
          if (v) filter[key] = v;
        }
        if (filter.status && !["open", "completed", "all"].includes(filter.status)) {
          throw new BadRequest(`Invalid status "${filter.status}" — expected open, completed or all`);
        }
        if (filter.section) filter.section = oneOf(filter.section, SECTIONS, "section");
        if (filter.view) filter.view = oneOf(filter.view, VIEWS, "view");
        if (filter.date) filter.date = validDate(filter.date);
        if (filter.from) filter.from = validDate(filter.from);
        if (filter.to) filter.to = validDate(filter.to);
        const tasks = store.list(filter);
        return send(res, 200, { success: true, count: tasks.length, tasks });
      }

      if (method === "GET" && pathname === "/task" ) {
        const id = searchParams.get("id");
        if (!id) throw new BadRequest("Missing 'id'");
        const task = store.get(id);
        if (!task) return send(res, 404, { success: false, error: `No task with id ${id}` });
        return send(res, 200, { success: true, task });
      }

      if (method === "POST" && (pathname === "/add-task" || pathname === "/tasks")) {
        const body = await readBody(req);
        const fields = buildTask(body);
        const task = store.create(fields);
        return send(res, 201, { success: true, task });
      }

      if (method === "POST" && pathname === "/complete-task") {
        const body = await readBody(req);
        const id = requireId(body);
        const completed = body.completed === undefined ? true : Boolean(body.completed);
        const task = store.setCompleted(id, completed);
        if (!task) return send(res, 404, { success: false, error: `No task with id ${id}` });
        return send(res, 200, { success: true, task });
      }

      if (method === "POST" && pathname === "/update-task") {
        const body = await readBody(req);
        const id = requireId(body);
        if (!store.get(id)) return send(res, 404, { success: false, error: `No task with id ${id}` });
        const { id: _ignored, ...rest } = body;
        const togglesCompletion = rest.completed !== undefined;
        if (togglesCompletion) {
          store.setCompleted(id, Boolean(rest.completed));
          delete rest.completed;
        }
        let task = store.get(id);
        if (Object.keys(rest).length > 0) task = store.update(id, buildPatch(rest));
        else if (!togglesCompletion) throw new BadRequest("Nothing to update");
        return send(res, 200, { success: true, task });
      }

      if (method === "POST" && pathname === "/delete-task") {
        const body = await readBody(req);
        const id = requireId(body);
        const task = store.remove(id);
        if (!task) return send(res, 404, { success: false, error: `No task with id ${id}` });
        return send(res, 200, { success: true, id, task });
      }

      if (method === "POST" && pathname === "/clear-completed") {
        const body = await readBody(req);
        const section = body.section ? oneOf(body.section, SECTIONS, "section") : undefined;
        const removed = store.removeCompleted(section);
        return send(res, 200, { success: true, removed: removed.length });
      }

      if (method === "GET") return serveStatic(req, res, pathname);
      return send(res, 405, { success: false, error: `${method} ${pathname} is not supported` });
    } catch (err) {
      if (err instanceof BadRequest) return send(res, 400, { success: false, error: err.message });
      process.stderr.write(`dayflow: ${err.stack || err.message}\n`);
      return send(res, 500, { success: false, error: "Internal server error" });
    }
  });

  server.on("close", () => {
    for (const res of clients) res.end();
    clients.clear();
  });

  return server;
}

// ── Entry point ──────────────────────────────────────────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const store = new Store(defaultDataFile());
  const server = createServer(store);

  server.listen(PORT, HOST, () => {
    const { port } = server.address();
    process.stdout.write(
      `\n  DayFlow running\n` +
      `  ── open  http://${HOST}:${port}\n` +
      `  ── data  ${store.file}\n` +
      `  ── ${store.tasks.length} task(s), ${store.tasks.filter((t) => !t.completed).length} open\n\n`
    );
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      process.stderr.write(`dayflow: port ${PORT} is already in use — is DayFlow already running?\n`);
      process.exit(1);
    }
    throw err;
  });

  const shutdown = () => {
    try {
      store.flush();
    } catch (err) {
      process.stderr.write(`dayflow: final save failed: ${err.message}\n`);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
