import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createServer } from "../server.js";
import { Store } from "../lib/store.js";

/** A server on an ephemeral port backed by a throwaway data file. */
async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dayflow-test-"));
  const store = new Store(path.join(dir, "tasks.json"));
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, urlPath, body) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data, res };
  };

  try {
    await fn({ base, call, store });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const add = (call, body) => call("POST", "/add-task", body);

test("health reports the data file and counts", async () => {
  await withServer(async ({ call, store }) => {
    const { status, data } = await call("GET", "/health");
    assert.equal(status, 200);
    assert.equal(data.app, "dayflow");
    assert.equal(data.dataFile, store.file);
    assert.equal(data.tasks, 0);
  });
});

test("natural-language create returns a full task", async () => {
  await withServer(async ({ call }) => {
    const { status, data } = await add(call, { text: "Call Mekdi at 7pm tomorrow, urgent" });
    assert.equal(status, 201);
    assert.equal(data.success, true);
    assert.match(data.task.title, /Call Mekdi/);
    assert.equal(data.task.dueTime, "19:00");
    assert.equal(data.task.priority, "high");
    assert.equal(data.task.completed, false);
    assert.ok(data.task.id);
  });
});

test("structured create accepts the MCP server's snake_case payload", async () => {
  await withServer(async ({ call }) => {
    const { data } = await add(call, {
      title: "Abel repayment",
      due_date: "2026-09-25",
      due_time: "9:00",
      priority: "high",
      category: "owe_me",
      view: "week",
      owed_by: "Abel",
      owed_amount: "$20",
      notes: "Sent a reminder already",
      source: "mcp",
    });
    assert.deepEqual(
      [data.task.section, data.task.view, data.task.dueDate, data.task.dueTime, data.task.owedBy, data.task.owedAmount, data.task.source],
      ["owe_me", "week", "2026-09-25", "09:00", "Abel", "$20", "mcp"]);
  });
});

test("an amount without an explicit column lands in Owe Me", async () => {
  await withServer(async ({ call }) => {
    const { data } = await add(call, { title: "Dawit", owed_amount: "300 ETB" });
    assert.equal(data.task.section, "owe_me");
  });
});

test("create rejects bad input with a usable message", async () => {
  await withServer(async ({ call }) => {
    for (const [body, pattern] of [
      [{}, /either 'text'/],
      [{ title: "   " }, /cannot be empty/],
      [{ title: "x", due_date: "2026-02-31" }, /no such day/],
      [{ title: "x", due_date: "next tuesday" }, /expected YYYY-MM-DD/],
      [{ title: "x", due_time: "25:00" }, /out of range/],
      [{ title: "x", priority: "urgent" }, /Invalid priority/],
      [{ title: "x", category: "inbox" }, /Invalid category/],
      [{ title: "x", view: "year" }, /Invalid view/],
    ]) {
      const { status, data } = await add(call, body);
      assert.equal(status, 400, JSON.stringify(body));
      assert.equal(data.success, false);
      assert.match(data.error, pattern);
    }
  });
});

test("malformed JSON and oversized bodies are refused", async () => {
  await withServer(async ({ base }) => {
    const bad = await fetch(`${base}/add-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{nope",
    });
    assert.equal(bad.status, 400);
    const huge = await fetch(`${base}/add-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(70000) }),
    }).catch(() => ({ status: 400 }));
    assert.ok(huge.status >= 400);
  });
});

test("listing filters by status, section and keyword", async () => {
  await withServer(async ({ call }) => {
    const a = (await add(call, { title: "Write spec", due_date: "2026-09-20" })).data.task;
    await add(call, { title: "Abel repayment", category: "owe_me", due_date: "2026-09-25", notes: "coffee money" });
    await call("POST", "/complete-task", { id: a.id });

    assert.equal((await call("GET", "/tasks")).data.count, 2);
    assert.equal((await call("GET", "/tasks?status=open")).data.count, 1);
    assert.equal((await call("GET", "/tasks?status=completed")).data.tasks[0].id, a.id);
    assert.equal((await call("GET", "/tasks?section=owe_me")).data.count, 1);
    assert.equal((await call("GET", "/tasks?q=coffee")).data.count, 1, "searches notes");
    assert.equal((await call("GET", "/tasks?q=SPEC")).data.count, 1, "search is case-insensitive");
    assert.equal((await call("GET", "/tasks?date=2026-09-25")).data.count, 1);
    assert.equal((await call("GET", "/tasks?from=2026-09-21&to=2026-09-30")).data.count, 1);
    assert.equal((await call("GET", "/tasks?status=sideways")).status, 400);
  });
});

test("listing sorts open work first, then by date and time", async () => {
  await withServer(async ({ call }) => {
    await add(call, { title: "later", due_date: "2026-09-22" });
    await add(call, { title: "early", due_date: "2026-09-21", due_time: "08:00" });
    const done = (await add(call, { title: "done", due_date: "2026-09-20" })).data.task;
    await add(call, { title: "midday", due_date: "2026-09-21", due_time: "13:00" });
    await call("POST", "/complete-task", { id: done.id });
    const titles = (await call("GET", "/tasks")).data.tasks.map((t) => t.title);
    assert.deepEqual(titles, ["early", "midday", "later", "done"]);
  });
});

test("complete then reopen a task", async () => {
  await withServer(async ({ call }) => {
    const { id } = (await add(call, { title: "Pay rent" })).data.task;
    const done = await call("POST", "/complete-task", { id });
    assert.equal(done.data.task.completed, true);
    assert.ok(done.data.task.completedAt);
    const reopened = await call("POST", "/complete-task", { id, completed: false });
    assert.equal(reopened.data.task.completed, false);
    assert.equal(reopened.data.task.completedAt, null);
  });
});

test("update changes fields, clears them with null, and validates", async () => {
  await withServer(async ({ call }) => {
    const { id } = (await add(call, { text: "Gym at 6 tomorrow" })).data.task;
    const up = await call("POST", "/update-task", {
      id, title: "Gym with Sami", dueDate: "2026-10-02", dueTime: "07:15", priority: "low", notes: "bring shoes",
    });
    assert.deepEqual(
      [up.data.task.title, up.data.task.dueDate, up.data.task.dueTime, up.data.task.priority, up.data.task.notes],
      ["Gym with Sami", "2026-10-02", "07:15", "low", "bring shoes"]);

    const cleared = await call("POST", "/update-task", { id, dueTime: null });
    assert.equal(cleared.data.task.dueTime, null);

    assert.equal((await call("POST", "/update-task", { id, priority: "later" })).status, 400);
    assert.equal((await call("POST", "/update-task", { id })).status, 400, "nothing to update");

    const moved = await call("POST", "/update-task", { id, completed: true, section: "owe_me" });
    assert.equal(moved.data.task.completed, true);
    assert.equal(moved.data.task.section, "owe_me");
  });
});

test("delete removes a task; clear-completed sweeps the rest", async () => {
  await withServer(async ({ call }) => {
    const a = (await add(call, { title: "one" })).data.task;
    const b = (await add(call, { title: "two" })).data.task;
    await add(call, { title: "three", category: "owe_me" });
    assert.equal((await call("POST", "/delete-task", { id: a.id })).data.success, true);
    assert.equal((await call("GET", "/tasks")).data.count, 2);

    await call("POST", "/complete-task", { id: b.id });
    const cleared = await call("POST", "/clear-completed", {});
    assert.equal(cleared.data.removed, 1);
    assert.equal((await call("GET", "/tasks")).data.count, 1);
  });
});

test("unknown ids are 404, not silent successes", async () => {
  await withServer(async ({ call }) => {
    for (const p of ["/complete-task", "/update-task", "/delete-task"]) {
      const { status, data } = await call("POST", p, { id: "t_missing", title: "x" });
      assert.equal(status, 404, p);
      assert.match(data.error, /No task with id/);
    }
    assert.equal((await call("POST", "/delete-task", {})).status, 400, "missing id");
  });
});

test("the parse endpoint previews without creating anything", async () => {
  await withServer(async ({ call }) => {
    const { data } = await call("GET", "/parse?text=" + encodeURIComponent("Call Mekdi at 7pm, urgent"));
    assert.equal(data.parsed.priority, "high");
    assert.equal(data.parsed.dueTime, "19:00");
    assert.equal((await call("GET", "/tasks")).data.count, 0);
    assert.equal((await call("GET", "/parse?text=")).data.parsed, null);
  });
});

test("tasks survive a restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dayflow-persist-"));
  const file = path.join(dir, "tasks.json");
  try {
    const first = new Store(file);
    first.create({ title: "Keep me", section: "todo", view: "day", priority: "medium", dueDate: "2026-09-20", dueTime: null });
    first.flush();
    const second = new Store(file);
    assert.equal(second.list().length, 1);
    assert.equal(second.list()[0].title, "Keep me");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt data file is set aside, not silently trusted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dayflow-corrupt-"));
  const file = path.join(dir, "tasks.json");
  try {
    fs.writeFileSync(file, "{ not json");
    const store = new Store(file);
    assert.deepEqual(store.list(), []);
    assert.ok(fs.readdirSync(dir).some((f) => f.includes("corrupt")), "kept a copy of the bad file");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the UI is served and path traversal is blocked", async () => {
  await withServer(async ({ base }) => {
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /DayFlow/);

    assert.equal((await fetch(base + "/app.js")).status, 200);
    assert.equal((await fetch(base + "/app.css")).status, 200);
    assert.equal((await fetch(base + "/nope.txt")).status, 404);
    assert.equal((await fetch(base + "/%2e%2e%2f%2e%2e%2fetc%2fpasswd")).status, 404);
  });
});

test("requests addressed to another host are refused", async () => {
  // `fetch` refuses to set Host, so this one goes out over raw HTTP — it is the
  // DNS-rebinding guard, and it has to hold for a real attacker's request.
  await withServer(async ({ base }) => {
    const { port } = new URL(base);
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/tasks", method: "GET", headers: { Host: "attacker.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 403);
  });
});

test("the event stream announces changes", async () => {
  await withServer(async ({ base, call }) => {
    const res = await fetch(base + "/events", { headers: { Accept: "text/event-stream" } });
    assert.match(res.headers.get("content-type"), /event-stream/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    const seen = (async () => {
      let buf = "";
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes("event: change")) return buf;
      }
      return buf;
    })();

    await new Promise((r) => setTimeout(r, 60));
    await call("POST", "/add-task", { title: "Ping the stream" });
    const buf = await seen;
    assert.match(buf, /event: change/);
    assert.match(buf, /"kind":"created"/);
    await reader.cancel();
  });
});

test("unsupported methods get a clear 405", async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(base + "/tasks", { method: "DELETE" });
    assert.equal(res.status, 405);
  });
});
