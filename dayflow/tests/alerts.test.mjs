// Alert tests: which reminders fire, and which must not.
//
// The interesting cases are all about restraint — not firing twice, not firing
// for something already done, not emptying a fortnight of missed reminders onto
// the screen at once. Pure logic. Run with `npm test`.

import { alertTimesFor, alertKey, pendingAlerts, alertBody, alertSummary, pruneShown }
  from '../src/services/alerts.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// A task due at 09:00 on a fixed day, with a ten-minute early reminder.
const day = new Date(2026, 0, 15, 9, 0, 0, 0);
const task = (over = {}) => ({
  id: 't1',
  title: 'dentist',
  dueDate: day.toISOString(),
  dueTime: '09:00',
  earlyReminderMinutes: 0,
  completed: false,
  ...over,
});
const AT = day.getTime();

// ── Reading the times off a task ──
ok('a due time is read', alertTimesFor(task()).due === AT);
ok('no early reminder means no early time', alertTimesFor(task()).early === null);
ok('an early reminder is that many minutes before',
   alertTimesFor(task({ earlyReminderMinutes: 10 })).early === AT - 10 * 60000);
ok('a task with no time has no alerts', alertTimesFor(task({ dueTime: '' })) === null);
ok('a task with no date has no alerts', alertTimesFor(task({ dueDate: '' })) === null);
ok('a malformed time has no alerts', alertTimesFor(task({ dueTime: 'soon' })) === null);
ok('a malformed date has no alerts', alertTimesFor(task({ dueDate: 'whenever' })) === null);
ok('no task at all is handled', alertTimesFor(undefined) === null);
// The time on the task wins over any time inside the stored date.
ok('the due time overrides the time of day in the date',
   alertTimesFor(task({ dueTime: '17:30' })).due === new Date(2026, 0, 15, 17, 30, 0, 0).getTime());

// ── Firing ──
ok('nothing fires before the time', pendingAlerts({ tasks: [task()], now: AT - 1000, shown: [] }).length === 0);
ok('the due alert fires on the minute', pendingAlerts({ tasks: [task()], now: AT, shown: [] }).length === 1);
ok('it still fires a little late', pendingAlerts({ tasks: [task()], now: AT + 60000, shown: [] }).length === 1);

{
  const both = pendingAlerts({ tasks: [task({ earlyReminderMinutes: 10 })], now: AT, shown: [] });
  ok('early and due are separate alerts', both.length === 2);
  ok('the earlier one comes first', both[0].kind === 'early' && both[1].kind === 'due');
}
ok('the early one fires without the due one',
   pendingAlerts({ tasks: [task({ earlyReminderMinutes: 10 })], now: AT - 5 * 60000, shown: [] })
     .map(a => a.kind).join() === 'early');

// ── Restraint ──
{
  const first = pendingAlerts({ tasks: [task()], now: AT, shown: [] });
  const again = pendingAlerts({ tasks: [task()], now: AT + 20000, shown: first.map(a => a.key) });
  ok('an alert already shown does not fire again', again.length === 0);
}
ok('a completed task does not alert',
   pendingAlerts({ tasks: [task({ completed: true })], now: AT, shown: [] }).length === 0);
ok('a task without a time never alerts',
   pendingAlerts({ tasks: [task({ dueTime: '' })], now: AT, shown: [] }).length === 0);
ok('an alert past the grace window is not raised on a later launch',
   pendingAlerts({ tasks: [task()], now: AT + 13 * 60 * 60 * 1000, shown: [] }).length === 0);
ok('but one inside the window is, so a reminder missed while away still lands',
   pendingAlerts({ tasks: [task()], now: AT + 60 * 60 * 1000, shown: [] }).length === 1);

// Moving a task's time is a new alert, not a silenced one.
{
  const shown = pendingAlerts({ tasks: [task()], now: AT, shown: [] }).map(a => a.key);
  const moved = task({ dueTime: '10:00' });
  const later = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
  ok('rescheduling a task gives it a fresh alert',
     pendingAlerts({ tasks: [moved], now: later, shown }).length === 1);
}

// ── Several tasks ──
{
  const due = pendingAlerts({
    tasks: [
      task({ id: 'a', dueTime: '09:00' }),
      task({ id: 'b', dueTime: '08:00' }),
      task({ id: 'c', dueTime: '23:00' }),
    ],
    now: AT,
    shown: [],
  });
  ok('only the ones that have come due fire', due.length === 2);
  ok('and they arrive oldest first', due.map(a => a.task.id).join() === 'b,a');
}
ok('an empty list is fine', pendingAlerts({ tasks: [], now: AT, shown: [] }).length === 0);
ok('a missing list is fine', pendingAlerts({ tasks: undefined, now: AT, shown: undefined }).length === 0);

// ── Keys ──
ok('a key names the task, the kind and the moment',
   alertKey('t1', 'due', AT) === `t1:due:${AT}`);
ok('the same alert always has the same key',
   alertKey('t1', 'due', AT) === alertKey('t1', 'due', AT));
ok('early and due are different keys', alertKey('t1', 'early', AT) !== alertKey('t1', 'due', AT));

// ── Wording ──
ok('the due alert says it is due now', alertBody({ kind: 'due', task: task() }) === 'Due now');
ok('minutes read as minutes',
   alertBody({ kind: 'early', task: task({ earlyReminderMinutes: 10 }) }) === 'Due in 10 minutes');
ok('an hour reads as an hour',
   alertBody({ kind: 'early', task: task({ earlyReminderMinutes: 60 }) }) === 'Due in 1 hour');
ok('a day reads as a day',
   alertBody({ kind: 'early', task: task({ earlyReminderMinutes: 1440 }) }) === 'Due in 1 day');

// ── Forgetting ──
{
  const old = alertKey('t1', 'due', AT - 48 * 60 * 60 * 1000);
  const recent = alertKey('t2', 'due', AT - 60000);
  const kept = pruneShown([old, recent], AT);
  ok('keys too old to fire again are dropped', !kept.includes(old));
  ok('keys that could still repeat are kept', kept.includes(recent));
  ok('rubbish in the list does not survive', pruneShown(['nonsense'], AT).length === 0);
  ok('a missing list is fine', pruneShown(undefined, AT).length === 0);
}

// ── Where the task lives ──
//
// A reminder that says only a title is as much use as remembering there was
// something. "Call about the survey" tells you nothing about which of two
// houses it concerns.
{
  const alert = { kind: 'due', task: { id: '1', title: 'Call about the survey' } };
  ok('an alert with no project says when and nothing else',
     alertBody(alert) === 'Due now', alertBody(alert));
  ok('and one in a project says where',
     alertBody(alert, 'Copper').includes('Copper'), alertBody(alert, 'Copper'));
  ok('with the when still first',
     alertBody(alert, 'Copper').startsWith('Due now'), alertBody(alert, 'Copper'));

  const early = { kind: 'early', task: { id: '2', title: 'x', earlyReminderMinutes: 10 } };
  ok('an early one says where too',
     alertBody(early, 'Wedding') === 'Due in 10 minutes  ·  Wedding', alertBody(early, 'Wedding'));
}

// ── One line, however many there are ──
//
// It used to say "2 tasks due", which is a notification about the existence of
// notifications: it named nothing, so there was nothing to act on.
{
  const one = { kind: 'due', task: { id: '1', title: 'Ring the agent', projectId: 'p1' } };
  const two = { kind: 'due', task: { id: '2', title: 'Pay the deposit', projectId: '' } };
  const where = t => (t.projectId === 'p1' ? 'Copper' : '');

  ok('nothing to say when there is nothing', alertSummary([], where) === '');
  ok('and nothing for junk', alertSummary(null, where) === '');
  ok('one alert names the task', alertSummary([one], where).includes('Ring the agent'));
  ok('and says which project', alertSummary([one], where).includes('Copper'));
  ok('and when it is due', alertSummary([one], where).startsWith('Due now'));

  const many = alertSummary([one, two], where);
  ok('several still name the first', many.includes('Ring the agent'), many);
  ok('and count the rest rather than listing them', many.includes('and 1 more'), many);
  ok('the count is of the others, not of all of them', !many.includes('and 2 more'), many);

  const three = alertSummary([one, two, { kind: 'due', task: { id: '3', title: 'z' } }], where);
  ok('three reads as two more', three.includes('and 2 more'), three);

  ok('a task with no project is not given an empty one',
     !alertSummary([two], where).includes('·'), alertSummary([two], where));
  ok('and a missing lookup is survived',
     alertSummary([one]).includes('Ring the agent'), alertSummary([one]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
