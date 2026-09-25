// Tasks that come back.
//
// The thing a list like this is asked for most and had least: rent on the
// thirtieth, the standing call on Mondays, the accountant every quarter-end.
// Without it they are retyped, and a task retyped from memory is a task
// eventually forgotten.
//
// What this is not is a recurrence engine. There is no series, no set of
// instances, no rule language, and above all no dialog asking whether you meant
// this one or all the future ones — which is the question that makes every
// calendar app unpleasant to use. There is one task at a time. Tick it off and
// the next one appears, carrying the repeat with it. Turn it off and no more
// appear. That is the whole model, and it fits in a sentence because it has to:
// anything larger would be a second app living inside this one.
//
// Pure: no storage, no React, no clock of its own beyond the one it is handed.

import { dueMoment } from './due.js';

export const REPEATS = [
  { key: 'none', label: 'Never' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

const EVERY = new Set(['daily', 'weekly', 'monthly']);

// A task from a vault written by any version of the app, read the same way.
export function repeatOf(task) {
  const raw = task && task.repeat;
  return typeof raw === 'string' && EVERY.has(raw) ? raw : 'none';
}

export function repeats(task) {
  return repeatOf(task) !== 'none';
}

export function repeatLabel(task) {
  const key = repeatOf(task);
  const found = REPEATS.find(r => r.key === key);
  return found && key !== 'none' ? found.label : null;
}

// How a task row says it. "Monthly" on its own, in a line that already holds a
// person's name and a date, reads as a description of one of those; "every
// month" can only be about the task.
const PHRASES = { daily: 'every day', weekly: 'every week', monthly: 'every month' };

export function repeatPhrase(task) {
  return PHRASES[repeatOf(task)] || null;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysInMonth(year, month) {
  // Day zero of the next month is the last day of this one.
  return new Date(year, month + 1, 0).getDate();
}

// One step forward.
//
// Never by arithmetic on milliseconds. A day is not 86,400,000 milliseconds
// twice a year, and a month is not a fixed number of anything — this project
// has already been caught once by the first of those.
//
// `anchor` is the day of the month the chain is supposed to land on, which
// matters only for monthly and only at the end of a month. Rent due on the
// thirty-first clamps to the twenty-eighth in February, and without the anchor
// it would then stay on the twenty-eighth for ever: one short month would
// quietly move the rent by three days for the rest of its life.
export function step(date, every, anchor) {
  const next = new Date(date);
  if (every === 'daily') {
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (every === 'weekly') {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (every !== 'monthly') return next;

  const wanted = Number.isInteger(anchor) && anchor >= 1 && anchor <= 31
    ? anchor
    : next.getDate();
  // To the first before moving months, or the thirty-first of January becomes
  // the third of March: JavaScript rolls the overflow forward rather than
  // refusing it.
  next.setDate(1);
  next.setMonth(next.getMonth() + 1);
  next.setDate(Math.min(wanted, daysInMonth(next.getFullYear(), next.getMonth())));
  return next;
}

// How many steps this is allowed to take looking for a date in the future. A
// daily task abandoned for a decade is the worst case anybody could contrive,
// and stopping is better than spinning.
const MAX_STEPS = 4000;

// The next date a repeating task should fall on, or null if it does not repeat.
//
// Counted from the due date, not from the day you ticked it off. A bill due on
// Fridays stays on Fridays even when it is paid on the Sunday — otherwise every
// late payment drags the whole series later, and a fortnight of those puts your
// Friday bill on a Wednesday.
//
// A task whose date has long passed skips to the next one still ahead rather
// than arriving already overdue. Ignoring the gym for five weeks should not
// hand you five sessions to tick off.
export function nextDate(task, now = new Date()) {
  const every = repeatOf(task);
  if (every === 'none') return null;

  const from = chainFrom(task, now);
  const anchor = anchorOf(task, from);

  const floor = startOfDay(now);
  let next = step(from, every, anchor);
  let guard = 0;
  while (startOfDay(next) <= floor && guard < MAX_STEPS) {
    next = step(next, every, anchor);
    guard += 1;
  }
  return next;
}

// Where the chain counts from: the task's own due date, or today if it never
// had one — which is the only thing "every week" can mean for a task that never
// said when.
function chainFrom(task, now) {
  const moment = dueMoment(task);
  return moment ? moment.at : now;
}

// Which day of the month the chain is anchored to. Written down the first time
// a monthly task comes round, because after that the due date is the clamped
// one and no longer remembers what it was aiming at: read from the date being
// left rather than the date being arrived at, or the thirty-first that became
// the twenty-eighth would record the twenty-eighth as the intention.
function anchorOf(task, from) {
  const stored = task && task.repeatDay;
  if (Number.isInteger(stored) && stored >= 1 && stored <= 31) return stored;
  return from.getDate();
}

// What the app should write when a repeating task is ticked off: the fields of
// the task that takes its place, or null if there is nothing to follow.
//
// Everything that describes the work travels — what it is, whose it is, where
// it lives, when in the day it falls. The recording does not. A voice note is
// about the one you just did, and copying it forward would put a fresh hundred
// kilobytes of audio into the vault every single week until it filled.
export function nextOccurrence(task, now = new Date()) {
  if (!task || !repeats(task)) return null;
  const at = nextDate(task, now);
  if (!at) return null;

  const every = repeatOf(task);
  const carried = {
    title: task.title,
    notes: task.notes || '',
    priority: task.priority,
    section: task.section,
    taskType: task.taskType,
    viewScope: task.viewScope,
    owePerson: task.owePerson || '',
    projectId: task.projectId || '',
    dueDate: at.toISOString(),
    dueTime: task.dueTime || '',
    reminderEnabled: !!task.reminderEnabled,
    earlyReminderMinutes: task.earlyReminderMinutes || 0,
    repeat: every,
  };
  if (every === 'monthly') carried.repeatDay = anchorOf(task, chainFrom(task, now));
  return carried;
}
