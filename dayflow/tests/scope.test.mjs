// Which page a task belongs on today.
//
// The three pages are a horizon rather than three folders, so a task put on
// Week because it was due Thursday is, on Thursday, a task for today. The rules
// only ever move a task nearer, and only when somebody actually chose the date
// — without that second part the whole of Week and Month lands on Day by
// Thursday, because every task carries a date whether or not anyone picked one.
//
// Run under a fixed zone: every assertion is about which side of a midnight
// something falls on.
import { scopeNow, scopeOf, movedItself, scopeNote, showsFrom, horizonStamp } from '../src/services/scope.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// Wednesday 30 September 2026, mid-morning. Its week runs Mon 28 to Sun 4.
const NOW = new Date('2026-09-30T10:00:00');
const iso = (y, m, d, hh = 9, mm = 0) => new Date(y, m - 1, d, hh, mm).toISOString();

// A task with a date somebody chose: a day other than today, or a time.
const on = (scope, y, m, d, extra = {}) => ({
  id: `${scope}-${d}`,
  title: 'Something',
  taskType: 'todo',
  viewScope: scope,
  createdAt: iso(2026, 9, 20),
  updatedAt: iso(2026, 9, 20),
  dueDate: iso(y, m, d),
  ...extra,
});

// ── What is stored ──────────────────────────────────────────────────────────
ok('a task says where it was filed', scopeOf({ viewScope: 'week' }) === 'week');
ok('and anything unrecognised is the day', scopeOf({ viewScope: 'fortnight' }) === 'day');
ok('as is nothing at all', scopeOf(null) === 'day');

// ── Week comes to Day on the day ────────────────────────────────────────────
{
  const thursday = on('week', 2026, 10, 1);
  ok('a week task due tomorrow is the week\'s during the day',
     scopeNow(thursday, NOW) === 'week', scopeNow(thursday, NOW));

  // Nine the evening before, so that the question "what is tomorrow" has an
  // answer while there is still an evening in which to do something about it.
  ok('and becomes tomorrow\'s business at nine in the evening',
     scopeNow(thursday, new Date('2026-09-30T21:00:00')) === 'day',
     scopeNow(thursday, new Date('2026-09-30T21:00:00')));
  ok('and not one minute before nine',
     scopeNow(thursday, new Date('2026-09-30T20:59:00')) === 'week');
  ok('still there at midnight', scopeNow(thursday, new Date('2026-10-01T00:01:00')) === 'day');
  ok('and on the morning itself',
     scopeNow(thursday, new Date('2026-10-01T07:00:00')) === 'day');

  // The evening before is one day, not one sleep: a task due on Monday shows
  // on Sunday evening, not on Saturday's.
  const monday = on('week', 2026, 10, 5);
  ok('the evening before is the evening before, not two',
     scopeNow(monday, new Date('2026-10-03T22:00:00')) === 'week',
     scopeNow(monday, new Date('2026-10-03T22:00:00')));
  ok('and the right evening works', scopeNow(monday, new Date('2026-10-04T21:30:00')) === 'day');

  ok('the moment is nine the evening before',
     showsFrom(new Date(2026, 9, 1, 11)).getDate() === 30
     && showsFrom(new Date(2026, 9, 1, 11)).getHours() === 21,
     String(showsFrom(new Date(2026, 9, 1, 11))));

  // And stays there rather than going back to the week it came from.
  ok('a week task whose day has been and gone is today\'s too',
     scopeNow(on('week', 2026, 9, 28), NOW) === 'day');
}

// ── A timed task due later today ────────────────────────────────────────────
{
  // Today's date with a time on it: chosen, because nothing sets a time by
  // accident. Five in the afternoon, and it is ten in the morning.
  const later = on('week', 2026, 9, 30, { dueTime: '17:00' });
  ok('a week task due at five this afternoon is today\'s at ten in the morning',
     scopeNow(later, NOW) === 'day', scopeNow(later, NOW));
}

// ── Month walks in two steps ────────────────────────────────────────────────
{
  const friday = on('month', 2026, 10, 2);
  ok('a month task due this Friday is this week\'s',
     scopeNow(friday, NOW) === 'week', scopeNow(friday, NOW));
  ok('and today\'s on the Friday',
     scopeNow(friday, new Date('2026-10-02T08:00:00')) === 'day');

  const nextWeek = on('month', 2026, 10, 7);
  ok('one due next week stays the month\'s',
     scopeNow(nextWeek, NOW) === 'month', scopeNow(nextWeek, NOW));

  // Seven rolling days rather than the calendar week. The calendar week is the
  // wrong shape for a horizon: read on a Sunday afternoon it has three hours
  // left in it, and everything due on Monday would fall past Week into Month.
  ok('Sunday is this week', scopeNow(on('month', 2026, 10, 4), NOW) === 'week');
  ok('and so is the Monday after, five days out',
     scopeNow(on('month', 2026, 10, 5), NOW) === 'week',
     scopeNow(on('month', 2026, 10, 5), NOW));
  ok('a week from today is not', scopeNow(on('month', 2026, 10, 7), NOW) === 'month',
     scopeNow(on('month', 2026, 10, 7), NOW));
}

// ── The date decides, not the page it was typed on ──────────────────────────
//
// This used only ever to move a task nearer, on the reasoning that a task on
// the day's page had been put there deliberately. It had not: a task takes the
// scope of the page it was typed on, and the parser calls anything within a
// couple of days "day". So something owed tomorrow night sat on today's page
// from the moment it was written, and the nine o'clock hand-over it was
// supposed to arrive by had nothing left to do.
{
  ok('a task typed on the day but due next month is filed under the month',
     scopeNow(on('day', 2026, 11, 20), NOW) === 'month',
     scopeNow(on('day', 2026, 11, 20), NOW));
  ok('and one due next month from the week goes the same way',
     scopeNow(on('week', 2026, 11, 20), NOW) === 'month');
  ok('a month task due next year is the month\'s',
     scopeNow(on('month', 2027, 2, 2), NOW) === 'month');

  // The exception. Picking Show under in the sheet is somebody saying where
  // they want it, and that is honoured — short of the day it comes due, because
  // a thing due tomorrow belongs in front of you whatever it was filed as.
  const pinned = { ...on('day', 2026, 11, 20), scopePinned: true };
  ok('unless it was said out loud, in which case it stays where it was put',
     scopeNow(pinned, NOW) === 'day', scopeNow(pinned, NOW));
  const pinnedWeek = { ...on('week', 2026, 10, 1), scopePinned: true };
  ok('and a pinned one still comes forward the evening before it is due',
     scopeNow(pinnedWeek, new Date('2026-09-30T21:00:00')) === 'day',
     scopeNow(pinnedWeek, new Date('2026-09-30T21:00:00')));
  ok('but not before', scopeNow(pinnedWeek, NOW) === 'week');
}

// ── The one this was reported for ───────────────────────────────────────────
//
// Sunday lunchtime, and a thing owed at ten tomorrow night was sitting on
// today's page. It should be the week's until nine this evening.
{
  const sunday = new Date('2026-09-27T13:02:00');
  const owed = {
    id: 'j', title: 'Jim owes me a message', taskType: 'done_for_me', owePerson: 'Jim',
    viewScope: 'day',
    createdAt: iso(2026, 9, 27, 12), updatedAt: iso(2026, 9, 27, 12),
    dueDate: iso(2026, 9, 28), dueTime: '22:00',
  };
  ok('at one in the afternoon it is the week\'s', scopeNow(owed, sunday) === 'week',
     scopeNow(owed, sunday));
  ok('at nine in the evening it is today\'s',
     scopeNow(owed, new Date('2026-09-27T21:00:00')) === 'day');
  ok('and it says where it came from once it arrives',
     scopeNote(owed, new Date('2026-09-27T21:00:00')) === null,
     'filed as day, so there is nowhere it came from');
}

// ── A date nobody chose moves nothing ───────────────────────────────────────
{
  // The stamp every task carries: dueDate is the moment it was made, to the
  // millisecond. Without this rule the whole of Week would arrive on Day.
  const stamp = iso(2026, 9, 20, 11, 4);
  const undated = {
    id: 'u', title: 'Someday', taskType: 'todo', viewScope: 'week',
    createdAt: stamp, updatedAt: stamp, dueDate: stamp,
  };
  ok('an undated week task stays on the week', scopeNow(undated, NOW) === 'week',
     scopeNow(undated, NOW));

  const undatedMonth = { ...undated, id: 'u2', viewScope: 'month' };
  ok('and an undated month task stays on the month',
     scopeNow(undatedMonth, NOW) === 'month');

  // Written by an older version, which stamped a moment slightly before the
  // task was made rather than leaving the date alone.
  const older = {
    id: 'o', title: 'Old', taskType: 'todo', viewScope: 'week',
    createdAt: iso(2026, 9, 20, 11, 4),
    dueDate: iso(2026, 9, 20, 11, 3),
  };
  ok('nor does a stamp from an older version move anything',
     scopeNow(older, NOW) === 'week', scopeNow(older, NOW));

  ok('a date that cannot be read moves nothing',
     scopeNow({ viewScope: 'week', dueDate: 'whenever' }, NOW) === 'week');
  ok('and neither does a clock that is not one',
     scopeNow(on('week', 2026, 9, 28), new Date('nope')) === 'week');
}

// ── Saying so ───────────────────────────────────────────────────────────────
{
  const thursday = on('week', 2026, 10, 1);
  ok('a task where it was put says nothing', scopeNote(thursday, NOW) === null);
  ok('and one that has come forward says where from',
     scopeNote(thursday, new Date('2026-10-01T07:00:00')) === 'from the week',
     scopeNote(thursday, new Date('2026-10-01T07:00:00')));
  ok('the month says month', scopeNote(on('month', 2026, 10, 2), NOW) === 'from the month',
     scopeNote(on('month', 2026, 10, 2), NOW));
  ok('and a month task arriving on the day says month too',
     scopeNote(on('month', 2026, 9, 29), NOW) === 'from the month',
     scopeNote(on('month', 2026, 9, 29), NOW));
  ok('moved is moved', movedItself(on('week', 2026, 9, 29), NOW) === true);
  // Filed further off than it was typed is still a move, but not one worth a
  // word: nothing has arrived, it is simply waiting.
  ok('and filed further off says nothing',
     scopeNote(on('week', 2026, 10, 20), NOW) === null,
     String(scopeNote(on('week', 2026, 10, 20), NOW)));
}

// ── When the screen has to look again ───────────────────────────────────────
{
  const afternoon = horizonStamp(new Date('2026-09-30T15:00:00'));
  ok('the stamp holds still through an afternoon',
     horizonStamp(new Date('2026-09-30T18:00:00')) === afternoon);
  ok('and turns over at nine',
     horizonStamp(new Date('2026-09-30T21:00:00')) !== afternoon);
  ok('the evening holds still too',
     horizonStamp(new Date('2026-09-30T23:30:00'))
     === horizonStamp(new Date('2026-09-30T21:00:00')));
  ok('and midnight turns it over again',
     horizonStamp(new Date('2026-10-01T00:01:00'))
     !== horizonStamp(new Date('2026-09-30T23:30:00')));
  ok('a clock that is not one stamps nothing', horizonStamp(new Date('nope')) === '');
}

// ── The clocks changing ─────────────────────────────────────────────────────
{
  // Britain puts them back on Sunday 25 October 2026. Seven days counted in
  // hours across that lands an hour early and pulls the boundary in with it.
  const from = new Date('2026-10-20T10:00:00');
  ok('five days out, across the change, is still the week\'s',
     scopeNow(on('month', 2026, 10, 25), from) === 'week',
     scopeNow(on('month', 2026, 10, 25), from));
  ok('and six days out is too',
     scopeNow(on('month', 2026, 10, 26), from) === 'week',
     scopeNow(on('month', 2026, 10, 26), from));
  // The boundary itself: seven days from the start of today, counted in days
  // rather than in 604,800,000 milliseconds.
  ok('seven days out is not', scopeNow(on('month', 2026, 10, 27), from) === 'month',
     scopeNow(on('month', 2026, 10, 27), from));
}

// ── Finished tasks are not a special case ───────────────────────────────────
ok('a finished week task due today is on the day like any other',
   scopeNow(on('week', 2026, 9, 29, { completed: true }), NOW) === 'day');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
