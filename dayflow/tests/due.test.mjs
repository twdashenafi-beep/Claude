// When a task is due, and whether it is late.
//
// The trap this has to avoid is the reason the app said nothing before. Every
// task carries a dueDate whether or not anyone chose one — a task made with no
// date is stamped with the moment it was made — so a naive "is dueDate in the
// past" marks half the list overdue by Thursday. A date only counts as meant
// when it says something the default could not have said.
//
// Run with `npm test`.
import { dueLabel, dueSpoken } from '../src/services/due.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// A Wednesday afternoon, so "tomorrow" and "this week" are unambiguous.
const NOW = new Date('2026-09-09T14:00:00');
const label = (task) => dueLabel(task, NOW);
const text = (task) => (label(task) || {}).text;
const late = (task) => !!(label(task) || {}).late;

const on = (day, time = '', extra = {}) => ({ dueDate: `${day}T10:00:00`, dueTime: time, ...extra });

// ── The default stamp says nothing ──
//
// This is the whole reason the rule is not "is it in the past".
ok('a task dated today with no time is silent', label(on('2026-09-09')) === null);
ok('and one made this morning is not called overdue',
   label({ dueDate: '2026-09-09T08:00:00', dueTime: '' }) === null);
ok('a task with no date at all is silent', label({ title: 'x' }) === null);
ok('a task with an unreadable date is silent', label({ dueDate: 'not a date' }) === null);
ok('nothing at all is silent', label(null) === null);
ok('undefined is silent', label(undefined) === null);

// ── Late ──
ok('a time earlier today is overdue', text(on('2026-09-09', '09:00')) === 'Overdue');
ok('and it is marked late', late(on('2026-09-09', '09:00')));
ok('yesterday is overdue', text(on('2026-09-08')) === 'Overdue');
ok('last month is overdue', text(on('2026-08-19', '09:00')) === 'Overdue');
ok('overdue says one word and no more', text(on('2026-06-01', '09:00')) === 'Overdue');

// ── Not late ──
ok('later today is just the time', text(on('2026-09-09', '17:30')) === '17:30');
ok('and is not marked late', late(on('2026-09-09', '17:30')) === false);
ok('tomorrow says tomorrow', text(on('2026-09-10')) === 'Tomorrow');
ok('tomorrow with a time carries it', text(on('2026-09-10', '11:00')) === 'Tomorrow 11:00');
ok('later this week is the day name', text(on('2026-09-11')) === 'Fri');
ok('with its time', text(on('2026-09-11', '08:15')) === 'Fri 08:15');
ok('a week out is a date', text(on('2026-09-16', '')) === '16 Sep');
ok('and further still', text(on('2026-10-14', '09:30')) === '14 Oct 09:30');

// ── Finished work is not late ──
ok('a completed overdue task says nothing',
   label(on('2026-08-19', '09:00', { completed: true })) === null);
ok('nor a completed one due tomorrow',
   label(on('2026-09-10', '11:00', { completed: true })) === null);

// ── The boundary between today and overdue is the minute, not the day ──
ok('a minute before now is overdue', text(on('2026-09-09', '13:59')) === 'Overdue');
ok('a minute after now is not', text(on('2026-09-09', '14:01')) === '14:01');

// ── Nonsense times do not throw or lie ──
for (const bad of ['99:99', '9:0', 'noon', '', null, undefined, 12]) {
  const t = { dueDate: '2026-09-11T10:00:00', dueTime: bad };
  let threw = false;
  try { dueLabel(t, NOW); } catch { threw = true; }
  ok(`a dueTime of ${JSON.stringify(bad)} is survived`, !threw);
}
ok('an impossible time falls back to the date alone',
   text({ dueDate: '2026-09-11T10:00:00', dueTime: '99:99' }) === 'Fri');

// ── What a screen reader is told ──
ok('overdue is spoken as overdue', dueSpoken(on('2026-09-08'), NOW) === 'overdue');
ok('and a date is spoken as due', dueSpoken(on('2026-09-10'), NOW) === 'due Tomorrow');
ok('and silence stays silent', dueSpoken(on('2026-09-09'), NOW) === null);

// ── The clock is passed in, so this is not a test that fails at midnight ──
{
  const midnight = new Date('2026-09-09T00:00:00');
  ok('at one minute past midnight, nine in the morning is still ahead',
     dueLabel(on('2026-09-09', '09:00'), midnight).text === '09:00');
  const lateNight = new Date('2026-09-09T23:59:00');
  ok('and at the end of the day it is behind',
     dueLabel(on('2026-09-09', '09:00'), lateNight).text === 'Overdue');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
