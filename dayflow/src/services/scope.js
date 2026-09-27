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
// A date decides the horizon; the page you happened to be standing on does not.
//
//   due tomorrow or sooner,  → Day, from nine the evening before
//     or overdue
//   due within a week        → Week
//   further off              → Month
//
// Nine in the evening rather than midnight, because the point of a day's page
// is to be read, and the moment anybody wants to know what tomorrow holds is
// the night before — not at seven the next morning when it is already too late
// to have thought about it. So the day changes over while there is still an
// evening left in it.
//
// The first version of this only ever moved a task nearer, on the reasoning
// that a task on the day's page had been put there deliberately. It had not.
// Nothing asked: a task takes the scope of the page it was typed on, and the
// parser calls anything within a couple of days "day" — so something owed
// tomorrow night sat on today's page from the moment it was written, and the
// nine o'clock hand-over it was supposed to arrive by had nothing to do.
//
// So a chosen date now decides, and the stored scope is what answers when
// nobody chose one. The exception is the sheet: picking Show under is a person
// saying where they want it, and that is honoured — short of the day it comes
// due, because a thing due tomorrow belongs in front of you whatever anybody
// filed it as.
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

// The scope as it is stored — what you chose, and what the sheet shows.
export function scopeOf(task) {
  const raw = task && task.viewScope;
  return raw === WEEK || raw === MONTH ? raw : DAY;
}

// The scope as it stands today.
// How far ahead still counts as this week's business.
//
// Seven rolling days rather than the calendar week, because the calendar week
// is the wrong shape for a horizon: on a Sunday afternoon it has three hours
// left in it, and everything due on Monday would fall straight past Week into
// Month. A week from now is a week from now whatever day it is.
const WEEK_DAYS = 7;

export function scopeNow(task, now = new Date()) {
  const stored = scopeOf(task);

  const at = new Date(now);
  if (Number.isNaN(at.getTime())) return stored;

  // Nobody chose a date, so the page it was filed on is all there is to go on.
  const moment = dueMoment(task);
  if (!moment) return stored;

  // Near enough to be today's business, whatever it was filed as.
  if (at >= showsFrom(moment.at)) return DAY;

  // Said out loud in the sheet: honoured until the day it comes due.
  if (task && task.scopePinned) return stored;

  if (moment.at < addDays(startOfDay(at), WEEK_DAYS)) return WEEK;
  return MONTH;
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
  // Only worth saying when a task has come nearer. A thing filed further off
  // than it was typed has not arrived anywhere; it is simply waiting, and "from
  // the day" on a task nobody moved would read as an accusation.
  const order = { day: 0, week: 1, month: 2 };
  if (order[scopeNow(task, now)] > order[scopeOf(task)]) return null;
  return `from the ${scopeOf(task) === MONTH ? 'month' : scopeOf(task)}`;
}
