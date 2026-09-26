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

import { instantOf, clockIn, sameClock, deviceZone, zoneLabel } from './zones.js';

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
//
// A time carries the zone it was set in, and the moment it names is that wall
// time in that zone. Three o'clock in London is three o'clock in London from
// anywhere on earth; read in New York it is ten in the morning, and the
// reminder arrives then rather than five hours after the call.
//
// Without a zone — every task written before this, and every device whose
// platform cannot do zone arithmetic — it falls back to the wall clock the app
// has always used. That is the behaviour people already have rather than a new
// and worse one, and it is exactly right until somebody travels.
//
// The calendar date is read in the task's own zone too. dueDate is an instant,
// and an instant near midnight is a different day depending on where you read
// it; the day that was meant is the day it was in the place it was chosen.
function dueAt(task) {
  if (!task || !task.dueDate) return null;
  const date = new Date(task.dueDate);
  if (Number.isNaN(date.getTime())) return null;

  const time = timeOf(task);
  if (!time) return date;

  const zone = task.tz;
  if (zone) {
    const on = clockIn(zone, date);
    if (on) {
      const instant = instantOf(on.year, on.month, on.day, time.h, time.m, zone);
      if (instant) return instant;
    }
  }

  date.setHours(time.h, time.m, 0, 0);
  return date;
}

// The clock this device shows for a task's time, which is not the clock it was
// set on once you have moved.
function shownTime(task, at) {
  const time = timeOf(task);
  if (!time) return '';
  const zone = task && task.tz;
  const here = deviceZone();
  if (!zone || !here || sameClock(zone, here, at)) return time.text;
  const local = clockIn(here, at);
  return local ? local.text : time.text;
}

// Where a time came from, when that is somewhere else. Null the rest of the
// time, which is almost always.
//
// Said rather than left to be discovered: a task that reads 10:00 when you
// typed 15:00 is either a conversion or a bug, and only one of those is worth
// leaving somebody to work out for themselves.
export function zoneNote(task, now = new Date()) {
  const time = timeOf(task);
  if (!time || !task || !task.tz) return null;
  const here = deviceZone();
  if (!here) return null;
  const at = dueAt(task);
  if (!at || sameClock(task.tz, here, at || now)) return null;
  return `Set for ${time.text} ${zoneLabel(task.tz)}`;
}

// Whether the date on a task is the one the app put there.
//
// `dueDate` falls back to the moment the task was created — the very same
// value, to the millisecond, as `createdAt`. So an untouched date is not merely
// probably the default: it is provably the default, and nothing a person picks
// can collide with it short of choosing the exact millisecond they were typing.
//
// This is what the rule below was missing. Recognising the stamp only by "is it
// today" worked on the day the task was made and not one morning longer: every
// undated task read "Overdue" from the next day onwards, which is precisely the
// flood this module exists to prevent.
function isDefaultStamp(task) {
  if (!task || !task.createdAt || !task.dueDate) return false;
  const made = new Date(task.createdAt);
  const due = new Date(task.dueDate);
  if (Number.isNaN(made.getTime()) || Number.isNaN(due.getTime())) return false;

  // Written now: the very same instant, because nothing was sent and the store
  // stamped both fields from one clock reading.
  if (due.getTime() === made.getTime()) return true;

  // Written by earlier versions, which invented a date instead of leaving it
  // alone: the moment the screen had been opened, or the tick just before the
  // store's own stamp. Both land a little before the task was made and on the
  // same day as it. Tasks already in a vault are the reason this is worth
  // matching — without it the fix would only ever help tasks made from here on,
  // and every task already written would go on calling itself overdue.
  //
  // A date somebody actually chose and did not put a time on is either today —
  // which the rule below silences anyway — or another day entirely, so nothing
  // deliberate is swallowed by this. The one it cannot see is a task added
  // after midnight to a screen that was opened the evening before; that one
  // keeps the old behaviour until it is next edited.
  return due.getTime() < made.getTime()
    && startOfDay(due).getTime() === startOfDay(made).getTime();
}

// When a task is actually due, for anything that needs the moment rather than
// the words for it — putting it in a calendar, most of all.
//
// null when nobody chose a date, which is the case the calendar most needs told.
// Every task carries a dueDate whether or not anyone picked one, so without this
// "add to calendar" would cheerfully file an undated task at whatever second it
// happened to be created.
//
// `timed` says whether a time was chosen as well.
//
// Unlike dueLabel, this says nothing about whether the task is finished. A
// label is about what to shout at you and a finished task is not late; a moment
// is a fact about the date, and filing a finished task in a calendar is merely
// pointless rather than wrong.
export function dueMoment(task) {
  const at = dueAt(task);
  if (!at) return null;

  const time = timeOf(task);
  if (!time && isDefaultStamp(task)) return null;

  return { at, timed: !!time, zone: (task && task.tz) || '' };
}

// The span a task should occupy in a calendar, or null if it should not be in
// one at all.
//
// This lives here, beside the rules it depends on, rather than in the calendar
// service — that module cannot be loaded outside a device, and this is the part
// that was wrong, so it is the part that needs testing.
//
// A task due on Friday and one due at half past five on Friday are different
// kinds of appointment. Only the second belongs at an hour of the day; the
// first is the whole of it, which is also what keeps an undated Friday from
// arriving as a midnight-to-one-in-the-morning meeting.
const HOUR_MS = 60 * 60 * 1000;

export function calendarWindow(task) {
  const moment = dueMoment(task);
  if (!moment) return null;

  if (moment.timed) {
    return {
      startDate: moment.at,
      endDate: new Date(moment.at.getTime() + HOUR_MS),
      allDay: false,
    };
  }

  // Midnight to midnight, counted in days rather than in hours. Twice a year a
  // day is 23 hours or 25, and adding 86,400,000 to the start of one of those
  // ends the event an hour inside the day before or the day after.
  const startDate = startOfDay(moment.at);
  const endDate = startOfDay(moment.at);
  endDate.setDate(endDate.getDate() + 1);
  return { startDate, endDate, allDay: true };
}

// { text, late } — or null when there is nothing worth saying.
export function dueLabel(task, now = new Date()) {
  if (!task || task.completed) return null;

  const at = dueAt(task);
  if (!at) return null;

  const time = timeOf(task);
  const hasTime = time !== null;
  const offset = daysBetween(now, at);

  // Nothing anyone chose: either the stamp the app put there when the task was
  // made, or a date of today with no time — which says nothing a bare task in
  // today's list was not already saying. The second still has to be checked on
  // its own, for tasks made before `createdAt` could be relied upon.
  if (!hasTime && (isDefaultStamp(task) || offset === 0)) return null;

  // One word. How late it is belongs in the task, not in a list you are
  // scanning — what you need here is which ones to look at.
  if (at.getTime() < now.getTime()) return { text: 'Overdue', late: true };

  const stamp = hasTime ? shownTime(task, at) : '';

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

// What a date looks like before the task exists.
//
// Deliberately more explicit than dueLabel. A label on a row is read inside a
// list, where "Mon" is plenty; a preview is the last moment anybody can notice
// that "Monday the 28th" was heard as a different day entirely — so it names
// the weekday and the date, and lets you check one against the other.
export function whenPreview(dueDate, dueTime, now = new Date()) {
  if (!dueDate) return null;
  const at = new Date(dueDate);
  if (Number.isNaN(at.getTime())) return null;

  const time = typeof dueTime === 'string' && /^\d{1,2}:\d{2}$/.test(dueTime) ? dueTime : '';
  const stamp = time ? ` ${time}` : '';
  const offset = daysBetween(now, at);

  if (offset === 0) return `Today${stamp}`;
  if (offset === 1) return `Tomorrow${stamp}`;
  if (offset === -1) return `Yesterday${stamp}`;

  const day = DAY_NAMES[at.getDay()].slice(0, 3);
  return `${day} ${at.getDate()} ${MONTHS[at.getMonth()]}${stamp}`;
}

// The same thing for a screen reader, which has room for whole words.
export function dueSpoken(task, now = new Date()) {
  const label = dueLabel(task, now);
  if (!label) return null;
  return label.late ? 'overdue' : `due ${label.text}`;
}
