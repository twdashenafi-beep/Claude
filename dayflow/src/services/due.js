// When a task is due, said in as few words as possible.
//
// The row used to show `dueTime` and nothing else, so a task due at nine this
// morning, one due at nine tomorrow, and one that was due at nine three weeks
// ago all read "09:00". The one thing a list of work has to tell you — what is
// late — was the one thing it could not say.
//
// The difficulty is that every task carries a dueDate whether or not anyone
// chose one: a task created with no date at all is stamped with the moment it
// was made. Treating that as a deadline would mark half the list overdue by
// Thursday. So a date only counts as meant when it says something the default
// could not have said:
//
//   a time is always explicit — nothing sets one by accident
//   a date other than today is always explicit — nothing defaults to Friday
//
// Anything else stays quiet, which is why an ordinary task still shows nothing.
//
// Pure: the clock is passed in.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
}

// The time on a task, or null when there is not a usable one.
//
// One function rather than a test in each place that needs it: the shape check
// and the range check used to live apart, so "99:99" counted as a time for the
// purpose of printing it and not for the purpose of using it, and a task read
// "Fri 99:99".
function timeOf(task) {
  const raw = task && task.dueTime;
  if (typeof raw !== 'string' || !/^\d{1,2}:\d{2}$/.test(raw)) return null;
  const [h, m] = raw.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  return { h, m, text: raw };
}

// The moment a task is actually due: its date, at its time if it has one.
function dueAt(task) {
  if (!task || !task.dueDate) return null;
  const date = new Date(task.dueDate);
  if (Number.isNaN(date.getTime())) return null;

  const time = timeOf(task);
  if (time) date.setHours(time.h, time.m, 0, 0);
  return date;
}

// { text, late } — or null when there is nothing worth saying.
export function dueLabel(task, now = new Date()) {
  if (!task || task.completed) return null;

  const at = dueAt(task);
  if (!at) return null;

  const time = timeOf(task);
  const hasTime = time !== null;
  const offset = daysBetween(now, at);

  // A date of today with no time is the default stamp, not a deadline.
  if (!hasTime && offset === 0) return null;

  // One word. How late it is belongs in the task, not in a list you are
  // scanning — what you need here is which ones to look at.
  if (at.getTime() < now.getTime()) return { text: 'Overdue', late: true };

  const stamp = hasTime ? time.text : '';

  if (offset === 0) return { text: stamp, late: false };
  if (offset === 1) return { text: `Tomorrow${stamp ? ` ${stamp}` : ''}`, late: false };
  if (offset > 1 && offset < 7) {
    return { text: `${DAY_NAMES[at.getDay()].slice(0, 3)}${stamp ? ` ${stamp}` : ''}`, late: false };
  }
  return {
    text: `${at.getDate()} ${MONTHS[at.getMonth()]}${stamp ? ` ${stamp}` : ''}`,
    late: false,
  };
}

// The same thing for a screen reader, which has room for whole words.
export function dueSpoken(task, now = new Date()) {
  const label = dueLabel(task, now);
  if (!label) return null;
  return label.late ? 'overdue' : `due ${label.text}`;
}
