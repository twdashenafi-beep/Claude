// Which page a task belongs on today.
//
// The three pages are a horizon, not three folders: Day is what is in front of
// you, Week is what is coming, Month is what is further off. A task put on Week
// on Monday because it was due Thursday is, on Thursday, simply a task for
// today — and until now you had to walk it across yourself, which is a chore
// the app was in a position to have done and did not, and which fails in the
// worst possible way when you forget: the one thing due today is the one thing
// not on today's page.
//
// So the page is worked out rather than stored. Nothing is rewritten, no
// updatedAt moves, nothing is pushed through the sync, and a horizon that moved
// because the date moved goes back on its own when the date does. The stored
// scope is still what you chose — it is what the sheet shows and what you edit;
// this is only where the choice lands as time passes.
//
// Two rules, and they only ever move a task nearer:
//
//   due tomorrow or sooner,    → Day, from nine the evening before
//     or overdue
//   due inside this week, and  → Week
//     filed under Month
//
// Nine in the evening rather than midnight, because the point of a day's page
// is to be read, and the moment anybody wants to know what tomorrow holds is
// the night before — not at seven the next morning when it is already too late
// to have thought about it. So the day changes over while there is still an
// evening left in it.
//
// Never the other way. A task you have deliberately put on Day stays on Day
// however far off its date is: you put it in front of you on purpose, and an
// app that quietly filed it away again would be arguing with you.
//
// A date only counts if somebody chose it, by the same test the row labels use.
// Every task carries a dueDate whether or not anyone picked one, and without
// that test the whole of Week and Month would land on Day by Thursday.
//
// Pure: the clock is passed in.

import { dueMoment } from './due.js';

// When tomorrow starts being today's business.
export const HANDOVER_HOUR = 21;

export const DAY = 'day';
export const WEEK = 'week';
export const MONTH = 'month';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Counted in days rather than added in milliseconds: twice a year one of them
// is 23 hours or 25, and tomorrow arrives an hour early or an hour late.
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// The Monday after the one this week started on. Monday-first, like the Friday
// page: a working week that starts on Sunday puts the weekend at the wrong end
// of it.
function endOfWeek(now) {
  const monday = startOfDay(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return addDays(monday, 7);
}

// The scope as it is stored — what you chose, and what the sheet shows.
export function scopeOf(task) {
  const raw = task && task.viewScope;
  return raw === WEEK || raw === MONTH ? raw : DAY;
}

// The scope as it stands today.
export function scopeNow(task, now = new Date()) {
  const stored = scopeOf(task);
  // An early-out rather than a rule: neither test below can return anything
  // further off than what is stored, so a task already on the day would come
  // back as the day anyway. It is here because it is the common case, and
  // because reading the date of every task on every render to be told what we
  // already knew is work for nothing.
  if (stored === DAY) return DAY;

  const moment = dueMoment(task);
  if (!moment) return stored;

  const at = new Date(now);
  if (Number.isNaN(at.getTime())) return stored;

  if (at >= showsFrom(moment.at)) return DAY;
  if (stored === MONTH && moment.at < endOfWeek(at)) return WEEK;
  return stored;
}

// The moment a task due on a given day starts appearing on the day's page:
// nine the evening before it.
export function showsFrom(due) {
  const evening = startOfDay(due);
  evening.setDate(evening.getDate() - 1);
  evening.setHours(HANDOVER_HOUR, 0, 0, 0);
  return evening;
}

// A string that changes exactly when the answers here could change: at midnight
// and again at nine in the evening.
//
// The screen works out which page a task belongs on from the clock, and a phone
// left on the desk would otherwise still be showing the afternoon's Day page at
// ten at night — which is precisely the hour this feature exists for.
export function horizonStamp(now = new Date()) {
  const at = new Date(now);
  if (Number.isNaN(at.getTime())) return '';
  return `${at.toDateString()}|${at.getHours() >= HANDOVER_HOUR ? 'evening' : 'day'}`;
}

// Whether a task is showing somewhere other than where it was filed — which is
// the one thing worth saying out loud about all this, since the sheet will go
// on showing Week for a task sitting on Day.
export function movedItself(task, now = new Date()) {
  return scopeNow(task, now) !== scopeOf(task);
}

// Said on the row, quietly, so the page does not look like it has made a
// mistake. Nothing for a task that is where it was put.
export function scopeNote(task, now = new Date()) {
  if (!movedItself(task, now)) return null;
  return scopeOf(task) === MONTH && scopeNow(task, now) === WEEK
    ? 'from the month'
    : `from the ${scopeOf(task)}`;
}
