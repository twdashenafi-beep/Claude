// The week, reckoned.
//
// Every other screen in this app answers "what now". None of them answers the
// question a week ends with, which is "did the week go where I meant it to" —
// and that question has a shape. It is four figures, and the app already knows
// all four; it has simply never put them on one page:
//
//   what got finished        the only evidence the week happened
//   what slipped             open, due, and the date has gone by
//   who owes you, still      and how long, and whether you have asked
//   what next week holds     before it is next week and too late to move it
//
// Deliberately not a dashboard. No percentages, no streak, no score out of ten:
// a number you can move by finishing something trivial is a number that will be
// moved by finishing something trivial. Four honest counts and the names under
// them, which is what a person actually reads on a Friday afternoon.
//
// Pure: the clock is passed in, and so is every task. No storage, no React.

import { daysSince, span } from './age.js';
import { chaseCount } from './chase.js';
import { dueMoment } from './due.js';

// Friday, Saturday, Sunday. The reckoning belongs to the end of the week
// rather than to one afternoon of it: plenty of people close the week on a
// Sunday evening, and a thing that was only ever available for one working day
// would be missed by half the weeks in a year.
const DAYS = new Set([5, 6, 0]);

export function isReckoningDay(now = new Date()) {
  const day = new Date(now).getDay();
  return DAYS.has(day);
}

// Monday, at the start of it. Monday rather than Sunday because the week this
// is reckoning is a working week, and a working week that starts on Sunday
// puts the weekend at the wrong end of its own summary.
export function weekStart(now = new Date()) {
  const d = new Date(now);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  // getDay is Sunday-first; this walks back to Monday, and from a Sunday it
  // walks back six days rather than forward one.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// Counted in days rather than added in milliseconds: twice a year a day is 23
// hours or 25, and a week measured in hours lands an hour inside the wrong one.
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// When a task was finished, as well as the record allows.
//
// `completedAt` is written from now on. Tasks finished before it existed have
// only `archivedAt` — accurate when the archive was the next thing you did —
// and failing that `updatedAt`, which is the moment of the tick unless the task
// has been edited since. Imperfect on old tasks and exact on new ones, which is
// the best any record can be about a field it did not used to keep.
export function finishedAt(task) {
  if (!task || !task.completed) return null;
  for (const raw of [task.completedAt, task.archivedAt, task.updatedAt]) {
    if (typeof raw !== 'string' || !raw) continue;
    const at = new Date(raw);
    if (!Number.isNaN(at.getTime())) return at;
  }
  return null;
}

function usable(task) {
  return !!task && !!task.id && !!String(task.title || '').trim();
}

// One list from the two the screen keeps, without counting anything twice.
function everything(tasks, archived) {
  const seen = new Map();
  for (const task of [...(tasks || []), ...(archived || [])]) {
    if (usable(task) && !seen.has(task.id)) seen.set(task.id, task);
  }
  return [...seen.values()];
}

const byOldest = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

export function reckon(tasks = [], archived = [], now = new Date()) {
  const at = new Date(now);
  const from = weekStart(at);
  if (!from) return null;
  const nextFrom = addDays(from, 7);
  const nextTo = addDays(from, 14);

  const all = everything(tasks, archived);
  const open = all.filter(t => !t.completed && !t.archivedAt);

  // Finished inside this week. Anything finished last week and ticked again
  // this one counts this week, which is the honest answer: that is when the
  // work of finishing it happened.
  const done = all
    .filter(t => {
      const when = finishedAt(t);
      return when && when >= from && when <= at;
    })
    .sort((a, b) => finishedAt(b) - finishedAt(a));

  // Open, dated, and the date has gone. dueMoment is what decides whether a
  // date was meant, so the stamp every undated task carries stays out of this —
  // without that the list would be half the app by Thursday.
  //
  // Your own work only. Something another person owes you that is past its date
  // has slipped too, but it is already named below under the person holding it,
  // and a week that counts the same thing twice is a week that reads worse than
  // it went.
  const slipped = open
    .filter(t => t.taskType !== 'done_for_me')
    .filter(t => {
      const moment = dueMoment(t);
      return moment && moment.at < at;
    })
    .sort((a, b) => dueMoment(a).at - dueMoment(b).at);

  // Still owed, oldest first, because the oldest is the one that has stopped
  // being late and started being a problem.
  const waiting = open
    .filter(t => t.taskType === 'done_for_me' && String(t.owePerson || '').trim())
    .sort(byOldest);

  const people = new Set(waiting.map(t => t.owePerson.trim().toLowerCase()));

  // Next week, already dated. The point of reading this on a Friday is that
  // there is still time to move something.
  const ahead = open
    .filter(t => {
      const moment = dueMoment(t);
      return moment && moment.at >= nextFrom && moment.at < nextTo;
    })
    .sort((a, b) => dueMoment(a).at - dueMoment(b).at);

  return {
    from,
    to: at,
    done,
    slipped,
    waiting,
    ahead,
    people: people.size,
  };
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// The week in one line. Said plainly: a week with three things slipped is not
// improved by being told it was 80% successful.
export function headline(sum) {
  if (!sum) return '';
  const parts = [];
  parts.push(`${sum.done.length} done`);
  if (sum.slipped.length) parts.push(`${sum.slipped.length} slipped`);
  if (sum.waiting.length) {
    parts.push(`${sum.waiting.length} waiting on ${plural(sum.people, 'person', 'people')}`);
  }
  if (parts.length === 1 && sum.done.length === 0) return 'Nothing done, nothing slipped';
  return parts.join('  ·  ');
}

// The short version, for the line in the header that offers the whole thing.
export function nudge(sum) {
  if (!sum) return null;
  if (sum.slipped.length) {
    return `The week: ${sum.done.length} done, ${sum.slipped.length} slipped`;
  }
  return `The week: ${sum.done.length} done`;
}

// How long one owed thing has been waiting, in the words the row already uses.
export function waitedFor(task, now = new Date()) {
  const days = daysSince(task && task.createdAt, now);
  if (days === null) return '';
  if (days <= 0) return 'asked today';
  if (days === 1) return 'asked yesterday';
  return `asked ${span(days)} ago`;
}

// Everything owed, gathered under the person who owes it, the person with the
// oldest outstanding thing first. The column is sorted by task, so this is the
// one place the relationship is visible at all.
export function byPerson(waiting) {
  const groups = new Map();
  for (const task of waiting || []) {
    const key = String(task.owePerson || '').trim().toLowerCase();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { person: task.owePerson.trim(), tasks: [] });
    groups.get(key).tasks.push(task);
  }
  return [...groups.values()]
    .map(g => ({
      ...g,
      tasks: [...g.tasks].sort(byOldest),
      chases: g.tasks.reduce((n, t) => n + chaseCount(t), 0),
    }))
    .sort((a, b) => byOldest(a.tasks[0], b.tasks[0]));
}
