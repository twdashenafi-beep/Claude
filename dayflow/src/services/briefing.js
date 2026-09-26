// The day, briefed.
//
// The weekly page asks whether the week went where you meant it to. This asks
// the morning's question instead, which is narrower and more urgent: what does
// today actually require, and what is already behind?
//
// Four sections, the same four shapes as the Friday page so the two read as
// siblings rather than as two different apps:
//
//   Late        dated before today and still open — the first thing to look at
//   Today       today's page, and anything dated today, timed ones in order
//   Waiting on  who owes you something, oldest first, and whether you asked
//   Tomorrow    so that nothing arrives as a surprise
//
// What it deliberately does not do: score the day, estimate a percentage, or
// say anything encouraging. A person who needs to be told that small progress
// is still progress is not the person reading this at seven in the morning.
//
// Pure: the clock is passed in, and so is every task.

import { dueMoment } from './due.js';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Counted in days rather than added in milliseconds: twice a year a day is 23
// hours or 25, and tomorrow is not always 86,400,000 away.
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function usable(task) {
  return !!task && !!task.id && !!String(task.title || '').trim();
}

function everything(tasks, archived) {
  const seen = new Map();
  for (const task of [...(tasks || []), ...(archived || [])]) {
    if (usable(task) && !seen.has(task.id)) seen.set(task.id, task);
  }
  return [...seen.values()];
}

// Timed first and in order, then everything without a time. A morning is read
// down the clock, and a task with no hour on it does not belong in the middle
// of one.
function byTimeThenOrder(a, b) {
  const at = dueMoment(a);
  const bt = dueMoment(b);
  const aTimed = at && at.timed;
  const bTimed = bt && bt.timed;
  if (aTimed && bTimed) return at.at - bt.at;
  if (aTimed) return -1;
  if (bTimed) return 1;
  return (a.order ?? 0) - (b.order ?? 0);
}

const byOldest = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

export function brief(tasks = [], archived = [], now = new Date()) {
  const at = new Date(now);
  if (Number.isNaN(at.getTime())) return null;
  const from = startOfDay(at);
  const nextFrom = addDays(from, 1);
  const nextTo = addDays(from, 2);

  const all = everything(tasks, archived);
  const open = all.filter(t => !t.completed && !t.archivedAt);
  // Your own work. What other people owe has its own section, and a thing
  // counted in two places makes the morning look worse than it is.
  const mine = open.filter(t => t.taskType !== 'done_for_me');

  const dated = (task, lower, upper) => {
    const moment = dueMoment(task);
    return moment && moment.at >= lower && moment.at < upper;
  };

  // Dated before today and still open. dueMoment is what decides whether a date
  // was meant, so the stamp every undated task carries stays out of this.
  const late = mine
    .filter(t => {
      const moment = dueMoment(t);
      return moment && moment.at < from;
    })
    .sort((a, b) => dueMoment(a).at - dueMoment(b).at);

  // Today's page, plus anything dated today wherever it is filed. Both, because
  // the two answer the same question from different directions: one is what you
  // put here this morning, the other is what fell due while you were not
  // looking at it.
  const today = mine
    .filter(t => t.viewScope === 'day' || dated(t, from, nextFrom))
    .sort(byTimeThenOrder);

  const tomorrow = mine
    .filter(t => dated(t, nextFrom, nextTo))
    .sort(byTimeThenOrder);

  const waiting = open
    .filter(t => t.taskType === 'done_for_me' && String(t.owePerson || '').trim())
    .sort(byOldest);

  const people = new Set(waiting.map(t => t.owePerson.trim().toLowerCase()));

  // Finished since midnight, for the one line under the headline. Counted the
  // same way the weekly page counts a week, so the two never disagree.
  const done = all.filter(t => {
    if (!t.completed) return false;
    for (const raw of [t.completedAt, t.archivedAt, t.updatedAt]) {
      if (typeof raw !== 'string' || !raw) continue;
      const when = new Date(raw);
      if (Number.isNaN(when.getTime())) continue;
      return when >= from && when <= at;
    }
    return false;
  });

  return { from, to: at, late, today, tomorrow, waiting, done, people: people.size };
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// The morning in one line, in the same grammar as the Friday page.
export function headline(sum) {
  if (!sum) return '';
  const parts = [];
  if (sum.late.length) parts.push(`${sum.late.length} late`);
  parts.push(`${sum.today.length} today`);
  if (sum.waiting.length) {
    parts.push(`${sum.waiting.length} waiting on ${plural(sum.people, 'person', 'people')}`);
  }
  if (sum.late.length === 0 && sum.today.length === 0 && sum.waiting.length === 0) {
    return 'Nothing due, nothing late';
  }
  return parts.join('  ·  ');
}

// Shown only when there is something to show. "Nothing finished yet" is true at
// half past seven in the morning and is not worth saying.
export function finishedNote(sum) {
  if (!sum || sum.done.length === 0) return null;
  return `${plural(sum.done.length, 'thing', 'things')} finished today`;
}
