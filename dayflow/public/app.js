/**
 * DayFlow UI.
 *
 * Loads the whole board once and filters in the browser — a personal task list
 * is small, and it keeps the day/week/month switch instant. The server pushes a
 * `change` event over SSE whenever anything edits the board (including Claude
 * through the MCP server), and we reload on it; if SSE is unavailable we poll.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  view: "day",
  anchor: todayISO(),
  tasks: [],
  query: "",
  showDone: false,
  editing: null,
};

// ── Dates ────────────────────────────────────────────────────────────────────

function todayISO() {
  return iso(new Date());
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shift(isoDate, days) {
  const d = fromISO(isoDate);
  d.setDate(d.getDate() + days);
  return iso(d);
}

function range(view, anchor) {
  const d = fromISO(anchor);
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const dow = (d.getDay() + 6) % 7; // Monday-first
    const start = new Date(d);
    start.setDate(d.getDate() - dow);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: iso(start), to: iso(end) };
  }
  return {
    from: iso(new Date(d.getFullYear(), d.getMonth(), 1)),
    to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const SHORT_FMT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

function rangeLabel() {
  const { from, to } = range(state.view, state.anchor);
  if (state.view === "day") {
    const date = DAY_FMT.format(fromISO(from));
    if (from === todayISO()) return `Today · ${date}`;
    if (from === shift(todayISO(), 1)) return `Tomorrow · ${date}`;
    if (from === shift(todayISO(), -1)) return `Yesterday · ${date}`;
    return date;
  }
  if (state.view === "week") return `${SHORT_FMT.format(fromISO(from))} – ${SHORT_FMT.format(fromISO(to))}`;
  return MONTH_FMT.format(fromISO(from));
}

function whenLabel(task) {
  if (!task.dueDate) return task.dueTime || "";
  const today = todayISO();
  let day;
  if (task.dueDate === today) day = "Today";
  else if (task.dueDate === shift(today, 1)) day = "Tomorrow";
  else if (task.dueDate === shift(today, -1)) day = "Yesterday";
  else day = SHORT_FMT.format(fromISO(task.dueDate));
  return task.dueTime ? `${day}, ${task.dueTime}` : day;
}

// ── Server calls ─────────────────────────────────────────────────────────────

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = {};
  try {
    data = await res.json();
  } catch { /* empty or non-JSON body */ }
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function load() {
  try {
    const { tasks } = await api("/tasks");
    state.tasks = tasks;
    setStatus("live");
    render();
  } catch (err) {
    setStatus("down", err.message);
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function visible() {
  const { from, to } = range(state.view, state.anchor);
  const today = todayISO();
  const spansToday = from <= today && today <= to;
  const q = state.query.trim().toLowerCase();

  return state.tasks.filter((t) => {
    if (q) {
      const haystack = `${t.title} ${t.notes || ""} ${t.owedBy || ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
      return true; // a search looks across the whole board, not just this period
    }
    if (!t.dueDate) return true;
    if (t.dueDate >= from && t.dueDate <= to) return true;
    // Open work from before today keeps showing up until it's dealt with.
    return spansToday && !t.completed && t.dueDate < today;
  });
}

function render() {
  $("#range").textContent = rangeLabel();
  $$(".view-btn").forEach((b) => b.classList.toggle("is-on", b.dataset.view === state.view));

  const shown = visible();
  const open = shown.filter((t) => !t.completed);
  const done = shown.filter((t) => t.completed);

  for (const section of ["todo", "owe_me"]) {
    const items = open.filter((t) => t.section === section);
    const list = $(`[data-list="${section}"]`);
    $(`[data-count="${section}"]`).textContent = String(items.length);
    paint(list, items, section);
  }

  const doneList = $('[data-list="done"]');
  $('[data-count="done"]').textContent = String(done.length);
  paint(doneList, done, "done");
  doneList.hidden = !state.showDone;
  $("#clear-done").hidden = done.length === 0;
  $("#toggle-done").setAttribute("aria-expanded", String(state.showDone));
  $("#toggle-done").firstChild.textContent = state.showDone ? "Hide completed " : "Show completed ";

  renderStats(open, done);
}

function renderStats(open, done) {
  const today = todayISO();
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today).length;
  const owed = open.filter((t) => t.section === "owe_me").length;
  const total = open.length + done.length;
  const pct = total ? Math.round((done.length / total) * 100) : 0;
  const cells = [
    { n: open.length, label: "Open" },
    { n: overdue, label: "Overdue", warn: overdue > 0 },
    { n: owed, label: "Owed to you" },
    { n: `${pct}%`, label: "Done this period" },
  ];
  $("#stats").innerHTML = cells
    .map((c) => `<div class="stat${c.warn ? " warn" : ""}"><b>${c.n}</b><span>${c.label}</span></div>`)
    .join("");
}

function paint(list, items, kind) {
  list.textContent = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = kind === "done"
      ? "Nothing completed yet."
      : kind === "owe_me"
        ? "Nobody owes you anything. Enjoy it."
        : state.query ? "No matches." : "Clear. Add something above.";
    list.append(li);
    return;
  }
  for (const task of items) {
    list.append(state.editing === task.id ? editorFor(task) : cardFor(task));
  }
}

function cardFor(task) {
  const node = $("#task-tpl").content.firstElementChild.cloneNode(true);
  node.dataset.id = task.id;
  node.classList.toggle("is-done", !!task.completed);
  node.classList.toggle("is-high", task.priority === "high" && !task.completed);
  const overdue = !task.completed && task.dueDate && task.dueDate < todayISO();
  node.classList.toggle("is-overdue", !!overdue);

  $(".title", node).textContent = task.title;
  $(".notes", node).textContent = task.notes || "";

  const meta = $(".meta", node);
  const bits = [];
  const when = whenLabel(task);
  if (when) bits.push(`<span class="when">${esc(when)}</span>`);
  if (overdue) bits.push('<span class="tag overdue">overdue</span>');
  if (task.priority !== "medium") bits.push(`<span class="tag ${task.priority}">${task.priority}</span>`);
  if (task.view && task.view !== "day") bits.push(`<span class="tag">${esc(task.view)}</span>`);
  if (task.owedBy) bits.push(`<span class="tag owe">${esc(task.owedBy)}</span>`);
  if (task.owedAmount) bits.push(`<span class="tag owe">${esc(task.owedAmount)}</span>`);
  if (task.source === "mcp") bits.push('<span class="tag" title="Created by Claude">claude</span>');
  meta.innerHTML = bits.join("");

  return node;
}

function editorFor(task) {
  const li = document.createElement("li");
  li.className = "editor";
  li.dataset.id = task.id;
  li.innerHTML = `
    <input class="e-title" value="${esc(task.title)}" aria-label="Title">
    <div class="grid">
      <label>Date<input class="e-date" type="date" value="${esc(task.dueDate || "")}"></label>
      <label>Time<input class="e-time" type="time" value="${esc(task.dueTime || "")}"></label>
      <label>Priority<select class="e-priority">
        ${["low", "medium", "high"].map((p) => `<option value="${p}"${p === task.priority ? " selected" : ""}>${p}</option>`).join("")}
      </select></label>
      <label>Column<select class="e-section">
        <option value="todo"${task.section === "todo" ? " selected" : ""}>To Do</option>
        <option value="owe_me"${task.section === "owe_me" ? " selected" : ""}>Owe Me</option>
      </select></label>
    </div>
    <div class="grid">
      <label>Owed by<input class="e-owedby" value="${esc(task.owedBy || "")}"></label>
      <label>Amount<input class="e-amount" value="${esc(task.owedAmount || "")}"></label>
    </div>
    <label>Notes<textarea class="e-notes" placeholder="Agenda, context, details…">${esc(task.notes || "")}</textarea></label>
    <div class="actions">
      <button type="button" class="chip-btn cancel">Cancel</button>
      <button type="button" class="primary save" style="height:32px;padding:0 16px">Save</button>
    </div>`;
  setTimeout(() => $(".e-title", li)?.focus(), 0);
  return li;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Status & toasts ──────────────────────────────────────────────────────────

function setStatus(kind, detail) {
  const el = $("#status");
  el.classList.toggle("is-live", kind === "live");
  el.classList.toggle("is-down", kind === "down");
  $(".status-text", el).textContent = kind === "live" ? "live" : kind === "down" ? "offline" : "connecting";
  el.title = detail || (kind === "down"
    ? "Can't reach the DayFlow server — is `npm start` still running?"
    : "Connected to the DayFlow server");
}

let toastTimer;
function toast(message, action) {
  $(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.append(Object.assign(document.createElement("span"), { textContent: message }));
  if (action) {
    const btn = Object.assign(document.createElement("button"), { textContent: action.label, type: "button" });
    btn.addEventListener("click", () => {
      el.remove();
      action.run();
    });
    el.append(btn);
  }
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), action ? 7000 : 3000);
}

async function guard(fn) {
  try {
    await fn();
  } catch (err) {
    toast(err.message);
    setStatus("down", err.message);
  }
}

// ── Capture ──────────────────────────────────────────────────────────────────

const captureInput = $("#capture-input");
let previewTimer;

$("#capture").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = captureInput.value.trim();
  if (!text) return;
  clearTimeout(previewTimer);
  guard(async () => {
    const { task } = await api("/add-task", { method: "POST", body: JSON.stringify({ text, source: "app" }) });
    captureInput.value = "";
    $("#preview").textContent = "";
    // Jump the board to the day the new task landed on, so it's never invisible.
    if (task.dueDate && state.view === "day") state.anchor = task.dueDate;
    await load();
    toast(`Added “${task.title}”`);
  });
});

captureInput.addEventListener("input", () => {
  clearTimeout(previewTimer);
  const text = captureInput.value.trim();
  if (!text) {
    $("#preview").textContent = "";
    return;
  }
  previewTimer = setTimeout(async () => {
    try {
      const { parsed } = await api(`/parse?text=${encodeURIComponent(text)}`);
      if (!parsed || captureInput.value.trim() !== text) return;
      const bits = [`<span class="tag">${esc(parsed.title)}</span>`, `<span class="tag">${esc(whenLabel(parsed))}</span>`];
      if (parsed.priority !== "medium") bits.push(`<span class="tag ${parsed.priority}">${parsed.priority}</span>`);
      if (parsed.section === "owe_me") bits.push('<span class="tag owe">Owe Me</span>');
      if (parsed.owedAmount) bits.push(`<span class="tag owe">${esc(parsed.owedAmount)}</span>`);
      if (parsed.view !== "day") bits.push(`<span class="tag">${esc(parsed.view)}</span>`);
      if (parsed.notes) bits.push(`<span class="tag">notes</span>`);
      $("#preview").innerHTML = `will add → ${bits.join(" ")}`;
    } catch { /* preview is a nicety; never block typing on it */ }
  }, 180);
});

// ── Board interactions ───────────────────────────────────────────────────────

$("#board").addEventListener("click", onBoardClick);
$(".done").addEventListener("click", onBoardClick);

function onBoardClick(e) {
  const row = e.target.closest("[data-id]");
  if (!row) return;
  const id = row.dataset.id;
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;

  if (e.target.closest(".check")) {
    return guard(async () => {
      await api("/complete-task", { method: "POST", body: JSON.stringify({ id, completed: !task.completed }) });
      await load();
    });
  }
  if (e.target.closest(".edit") || (e.target.closest(".title") && !state.editing)) {
    state.editing = id;
    return render();
  }
  if (e.target.closest(".del")) {
    return guard(async () => {
      await api("/delete-task", { method: "POST", body: JSON.stringify({ id }) });
      await load();
      toast(`Deleted “${task.title}”`, { label: "Undo", run: () => restore(task) });
    });
  }
  if (e.target.closest(".cancel")) {
    state.editing = null;
    return render();
  }
  if (e.target.closest(".save")) {
    const box = e.target.closest(".editor");
    const payload = {
      id,
      title: $(".e-title", box).value.trim() || task.title,
      due_date: $(".e-date", box).value || null,
      due_time: $(".e-time", box).value || null,
      priority: $(".e-priority", box).value,
      section: $(".e-section", box).value,
      owed_by: $(".e-owedby", box).value.trim() || null,
      owed_amount: $(".e-amount", box).value.trim() || null,
      notes: $(".e-notes", box).value,
    };
    return guard(async () => {
      await api("/update-task", { method: "POST", body: JSON.stringify(payload) });
      state.editing = null;
      await load();
    });
  }
}

function restore(task) {
  guard(async () => {
    const { task: created } = await api("/add-task", {
      method: "POST",
      body: JSON.stringify({
        title: task.title, notes: task.notes, category: task.section, view: task.view,
        priority: task.priority, due_date: task.dueDate, due_time: task.dueTime,
        owed_by: task.owedBy, owed_amount: task.owedAmount, source: task.source,
      }),
    });
    if (task.completed) {
      await api("/complete-task", { method: "POST", body: JSON.stringify({ id: created.id }) });
    }
    await load();
  });
}

$("#board").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList?.contains("e-title")) {
    e.preventDefault();
    e.target.closest(".editor").querySelector(".save").click();
  }
});

// ── Chrome: views, dates, search, theme, shortcuts ───────────────────────────

$(".views").addEventListener("click", (e) => {
  const btn = e.target.closest(".view-btn");
  if (!btn) return;
  state.view = btn.dataset.view;
  render();
});

const step = (dir) => {
  if (state.view === "day") state.anchor = shift(state.anchor, dir);
  else if (state.view === "week") state.anchor = shift(state.anchor, dir * 7);
  else {
    const d = fromISO(state.anchor);
    state.anchor = iso(new Date(d.getFullYear(), d.getMonth() + dir, 1));
  }
  render();
};
$("#prev").addEventListener("click", () => step(-1));
$("#next").addEventListener("click", () => step(1));
$("#today").addEventListener("click", () => {
  state.anchor = todayISO();
  render();
});

$("#search").addEventListener("input", (e) => {
  state.query = e.target.value;
  render();
});

$("#toggle-done").addEventListener("click", () => {
  state.showDone = !state.showDone;
  render();
});

$("#clear-done").addEventListener("click", () => {
  guard(async () => {
    const { removed } = await api("/clear-completed", { method: "POST", body: "{}" });
    await load();
    toast(`Cleared ${removed} completed task${removed === 1 ? "" : "s"}`);
  });
});

const THEME_KEY = "dayflow.theme";
function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch { /* private mode — the theme just won't stick */ }
}
try {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.dataset.theme = saved;
} catch { /* ignore */ }
$("#theme").addEventListener("click", () => {
  const order = ["auto", "light", "dark"];
  const current = document.documentElement.dataset.theme || "auto";
  applyTheme(order[(order.indexOf(current) + 1) % order.length]);
});

document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.key === "Escape") {
    if (state.editing) {
      state.editing = null;
      render();
    } else if (typing) {
      e.target.blur();
    }
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/") {
    e.preventDefault();
    $("#search").focus();
  } else if (e.key === "n") {
    e.preventDefault();
    captureInput.focus();
  } else if (e.key === "t") {
    state.anchor = todayISO();
    render();
  } else if (e.key === "ArrowLeft") {
    step(-1);
  } else if (e.key === "ArrowRight") {
    step(1);
  }
});

// ── Live updates ─────────────────────────────────────────────────────────────

function listen() {
  if (!("EventSource" in window)) {
    setInterval(load, 5000);
    return;
  }
  const source = new EventSource("/events");
  source.addEventListener("open", () => setStatus("live"));
  source.addEventListener("change", () => {
    if (!state.editing) load();
  });
  source.addEventListener("error", () => {
    setStatus("down");
    // EventSource retries on its own; a reload catches anything missed.
    setTimeout(load, 2500);
  });
}

// Midnight rollover: keep a board parked on "today" following the clock.
let lastKnownToday = todayISO();
setInterval(() => {
  const today = todayISO();
  if (today === lastKnownToday) return;
  if (state.anchor === lastKnownToday) state.anchor = today;
  lastKnownToday = today;
  render();
}, 30000);

load();
listen();
