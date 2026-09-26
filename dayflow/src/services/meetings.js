// Which meeting a task is for.
//
// The app now knows there is a board call at eleven. It does not know that
// three of the things on the list are *for* that board call — so the question
// an executive actually asks before walking into a room ("what am I meant to
// have with me?") is answered by memory, which is the one place it should not
// live. The two halves have been sitting next to each other since the diary
// arrived: events on one side, tasks on the other, and nothing joining them.
//
// A task names its meeting by title and start time rather than by the
// calendar's own id. Ids are not stable across a re-import — the file gives
// each occurrence a new one every time it is read, and the phone renumbers
// recurring events on its own schedule — so a link built on them would quietly
// come apart every time the diary was refreshed. A title and a minute survive
// that, and they survive the diary being replaced by one exported from
// somewhere else entirely.
//
// What they do not survive is the meeting being moved. That is the honest
// trade: the link is to "the board call at eleven on Thursday", and if it
// shifts to two o'clock the task keeps saying what it was for and stops being
// counted against the event. Better than a link that silently attaches itself
// to a different meeting of the same name.
//
// Pure: no clock of its own beyond what it is handed.

function minuteOf(value) {
  const at = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const rounded = new Date(at);
  rounded.setSeconds(0, 0);
  return rounded.toISOString();
}

function titleOf(value) {
  return String(value || '').trim();
}

// The two facts that identify a meeting, in one string.
function key(title, at) {
  const when = minuteOf(at);
  const name = titleOf(title).toLowerCase();
  if (!when || !name) return null;
  return `${name}@${when}`;
}

export function keyOfEvent(event) {
  if (!event || event.allDay) return null;
  return key(event.title, event.start);
}

// What a task carries: enough to name the meeting on the row even when the
// diary is not loaded, or the calendar has since been forgotten.
export function meetingOf(task) {
  const held = task && task.meeting;
  if (!held || typeof held !== 'object') return null;
  const when = minuteOf(held.at);
  const title = titleOf(held.title);
  if (!when || !title) return null;
  return { title, at: new Date(when) };
}

export function keyOfTask(task) {
  const held = meetingOf(task);
  return held ? key(held.title, held.at) : null;
}

// The fields to save when a meeting is chosen, or cleared.
export function attachTo(event) {
  if (!event || event.allDay) return { meeting: null };
  const when = minuteOf(event.start);
  const title = titleOf(event.title);
  if (!when || !title) return { meeting: null };
  return { meeting: { title, at: when } };
}

export const detach = { meeting: null };

// Everything on the list that is for this meeting, in the order it was made.
export function tasksFor(tasks, event) {
  const wanted = keyOfEvent(event);
  if (!wanted) return [];
  return (tasks || [])
    .filter(t => t && !t.archivedAt && keyOfTask(t) === wanted)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

// What the row says. The meeting's name and nothing else: a row is scanned, and
// the name is the part that tells you why the task exists.
export function meetingLabel(task) {
  const held = meetingOf(task);
  if (!held || !task || task.completed || task.archivedAt) return null;
  return `for ${held.title}`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// What the diary says beside a meeting: how much is attached, and how much of
// it is not ready.
export function meetingNote(tasks) {
  const all = (tasks || []).filter(Boolean);
  if (all.length === 0) return null;
  const open = all.filter(t => !t.completed).length;
  if (open === 0) return all.length === 1 ? '1 thing, done' : `${all.length} things, all done`;
  return `${plural(all.length, 'thing', 'things')}, ${open} still to do`;
}

// The meetings a task could be attached to: the ones on its own day when it has
// one, and otherwise the ones between now and a fortnight out.
//
// A fortnight rather than a week because the boundary has to fall somewhere and
// a week puts it exactly where people schedule — "the board call next Friday"
// is a week today, and a list that stopped one hour short of it would be
// maddening. The list is only ever shown when the task's own day has nothing on
// it, so the length costs little.
//
// All-day events are left out. An offsite is not a thing you bring three
// documents to at a particular hour, and offering it would bury the meetings
// that are.
const WINDOW_DAYS = 14;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function choices(events, dueDate, now = new Date()) {
  const timed = (events || []).filter(e => e && !e.allDay && e.start);

  const on = dueDate ? new Date(dueDate) : null;
  if (on && !Number.isNaN(on.getTime())) {
    const from = startOfDay(on);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const sameDay = timed
      .filter(e => e.start >= from && e.start < to)
      .sort((a, b) => a.start - b.start);
    if (sameDay.length) return sameDay;
  }

  const from = startOfDay(now);
  const to = new Date(from);
  to.setDate(to.getDate() + WINDOW_DAYS);
  return timed
    .filter(e => e.start >= from && e.start < to)
    .sort((a, b) => a.start - b.start);
}

// Whether the meeting a task names is still in the diary.
//
// Worth saying out loud rather than leaving the task pointing at nothing: a
// meeting that has been moved or cancelled is exactly the thing you want to
// find out before you have prepared for it.
export function stillThere(task, events) {
  const wanted = keyOfTask(task);
  if (!wanted) return true;
  return (events || []).some(e => keyOfEvent(e) === wanted);
}
