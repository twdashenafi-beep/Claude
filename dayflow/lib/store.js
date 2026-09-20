/**
 * DayFlow task store — a single JSON file, written atomically.
 *
 * Small enough to keep the whole board in memory: reads are synchronous over
 * the in-memory array, writes are debounced and flushed atomically (tmp file +
 * rename) so a crash mid-write can never truncate the real file.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const SECTIONS = ["todo", "owe_me"];
export const PRIORITIES = ["low", "medium", "high"];
export const VIEWS = ["day", "week", "month"];

export function defaultDataFile() {
  if (process.env.DAYFLOW_DATA) return path.resolve(process.env.DAYFLOW_DATA);
  return path.join(os.homedir(), ".dayflow", "tasks.json");
}

function newId() {
  return `t_${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

export class Store {
  constructor(file = defaultDataFile()) {
    this.file = file;
    this.tasks = [];
    this.listeners = new Set();
    this._flushTimer = null;
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
      this.tasks = Array.isArray(tasks) ? tasks.filter((t) => t && t.id) : [];
    } catch (err) {
      if (err.code !== "ENOENT") {
        // Never start from a blank board on a parse error — keep the bad file.
        const backup = `${this.file}.corrupt-${Date.now()}`;
        try {
          fs.renameSync(this.file, backup);
          process.stderr.write(`dayflow: unreadable data file, moved to ${backup}\n`);
        } catch { /* nothing more we can do */ }
      }
      this.tasks = [];
    }
  }

  /** Persist now, synchronously. Used on exit and by the tests. */
  flush() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const body = JSON.stringify({ version: 1, tasks: this.tasks }, null, 2);
    const tmp = path.join(dir, `.${path.basename(this.file)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, body, "utf8");
    fs.renameSync(tmp, this.file);
  }

  _save() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      try {
        this.flush();
      } catch (err) {
        process.stderr.write(`dayflow: failed to save: ${err.message}\n`);
      }
    }, 40);
    this._flushTimer.unref?.();
  }

  /** Subscribe to change events (used for the UI's live updates). */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(kind, task) {
    for (const fn of this.listeners) {
      try {
        fn({ kind, task });
      } catch { /* a broken listener must not break a write */ }
    }
  }

  get(id) {
    return this.tasks.find((t) => t.id === id) || null;
  }

  /**
   * @param {{status?: string, section?: string, q?: string, view?: string,
   *          date?: string, from?: string, to?: string}} [filter]
   */
  list(filter = {}) {
    let out = this.tasks;
    const { status, section, q, view, date, from, to } = filter;

    if (status === "open") out = out.filter((t) => !t.completed);
    else if (status === "completed") out = out.filter((t) => t.completed);
    if (section) out = out.filter((t) => t.section === section);
    if (view) out = out.filter((t) => t.view === view);
    if (date) out = out.filter((t) => t.dueDate === date);
    if (from) out = out.filter((t) => !t.dueDate || t.dueDate >= from);
    if (to) out = out.filter((t) => !t.dueDate || t.dueDate <= to);
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter((t) =>
        (t.title || "").toLowerCase().includes(needle) ||
        (t.notes || "").toLowerCase().includes(needle) ||
        (t.owedBy || "").toLowerCase().includes(needle));
    }
    return [...out].sort(compareTasks);
  }

  create(fields) {
    const now = new Date().toISOString();
    const task = {
      id: newId(),
      title: fields.title,
      notes: fields.notes || "",
      section: fields.section,
      view: fields.view,
      priority: fields.priority,
      dueDate: fields.dueDate ?? null,
      dueTime: fields.dueTime ?? null,
      owedBy: fields.owedBy ?? null,
      owedAmount: fields.owedAmount ?? null,
      completed: false,
      completedAt: null,
      source: fields.source || "app",
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.push(task);
    this._save();
    this._emit("created", task);
    return task;
  }

  update(id, patch) {
    const task = this.get(id);
    if (!task) return null;
    Object.assign(task, patch);
    task.updatedAt = new Date().toISOString();
    this._save();
    this._emit("updated", task);
    return task;
  }

  setCompleted(id, completed) {
    const task = this.get(id);
    if (!task) return null;
    task.completed = completed;
    task.completedAt = completed ? new Date().toISOString() : null;
    task.updatedAt = new Date().toISOString();
    this._save();
    this._emit(completed ? "completed" : "reopened", task);
    return task;
  }

  remove(id) {
    const i = this.tasks.findIndex((t) => t.id === id);
    if (i === -1) return null;
    const [task] = this.tasks.splice(i, 1);
    this._save();
    this._emit("deleted", task);
    return task;
  }

  removeCompleted(section) {
    const gone = this.tasks.filter((t) => t.completed && (!section || t.section === section));
    if (gone.length === 0) return [];
    this.tasks = this.tasks.filter((t) => !gone.includes(t));
    this._save();
    this._emit("cleared", null);
    return gone;
  }
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

/** Open before done, then by date, then timed before untimed, then priority. */
export function compareTasks(a, b) {
  if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
  const da = a.dueDate || "9999-12-31";
  const db = b.dueDate || "9999-12-31";
  if (da !== db) return da < db ? -1 : 1;
  const ta = a.dueTime || "99:99";
  const tb = b.dueTime || "99:99";
  if (ta !== tb) return ta < tb ? -1 : 1;
  const pa = PRIORITY_RANK[a.priority] ?? 1;
  const pb = PRIORITY_RANK[b.priority] ?? 1;
  if (pa !== pb) return pa - pb;
  return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
}
