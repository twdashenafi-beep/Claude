// Tasks that come back.
//
// Run under a timezone that actually changes its clocks, because two of the
// mistakes this guards against are invisible in UTC: a "day" that is not
// twenty-four hours, and an hour that happens twice. This project has already
// been caught by the first of them once.
//
// Run with `npm test`.
import {
  REPEATS, repeatOf, repeats, repeatLabel, repeatPhrase, step, nextDate, nextOccurrence,
} from '../src/services/repeat.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

ok('the tests are running somewhere with clock changes',
   Intl.DateTimeFormat().resolvedOptions().timeZone === 'Europe/London',
   Intl.DateTimeFormat().resolvedOptions().timeZone);

const day = d => d && new Date(d).toDateString();
// A task with a real due date: made well before the date it is due, so nothing
// mistakes the date for the stamp the app writes when you never chose one.
const task = (dueDate, extra = {}) => ({
  title: 'A thing',
  createdAt: '2026-01-01T09:00:00.000Z',
  dueDate,
  ...extra,
});

// ── Reading what a task says ──
ok('a task with nothing said does not repeat', repeatOf({ title: 'x' }) === 'none');
ok('nor one saying nonsense', repeatOf({ repeat: 'fortnightly' }) === 'none');
ok('nor one saying it in the wrong type', repeatOf({ repeat: 7 }) === 'none');
ok('daily is daily', repeatOf({ repeat: 'daily' }) === 'daily');
ok('and repeats() agrees', repeats({ repeat: 'weekly' }) && !repeats({ repeat: 'none' }));
ok('a repeat has a word for it', repeatLabel({ repeat: 'monthly' }) === 'Monthly');
ok('and not repeating has none', repeatLabel({ repeat: 'none' }) === null);
ok('there are four choices, one of them none', REPEATS.length === 4 && REPEATS[0].key === 'none');

// A row already carries a person's name and a date. "Monthly" among those reads
// as a description of one of them.
ok('a row says it as a phrase', repeatPhrase({ repeat: 'monthly' }) === 'every month');
ok('every day, not daily', repeatPhrase({ repeat: 'daily' }) === 'every day');
ok('and a task that does not repeat says nothing', repeatPhrase({ repeat: 'none' }) === null);

// ── One step ──
ok('a day is the next day', day(step(new Date(2026, 4, 10), 'daily')) === day(new Date(2026, 4, 11)));
ok('a week is seven days', day(step(new Date(2026, 4, 10), 'weekly')) === day(new Date(2026, 4, 17)));
ok('a month is the same date next month',
   day(step(new Date(2026, 4, 10), 'monthly')) === day(new Date(2026, 5, 10)));

// Month ends, where the naive version falls over. Adding a month to the 31st in
// JavaScript rolls the overflow forward: January the 31st becomes March the 3rd.
ok('the last day of January does not become March',
   day(step(new Date(2026, 0, 31), 'monthly')) === day(new Date(2026, 1, 28)),
   day(step(new Date(2026, 0, 31), 'monthly')));
ok('the 31st of March becomes the 30th of April',
   day(step(new Date(2026, 2, 31), 'monthly')) === day(new Date(2026, 3, 30)));
ok('a leap February takes the 29th',
   day(step(new Date(2028, 0, 31), 'monthly')) === day(new Date(2028, 1, 29)),
   day(step(new Date(2028, 0, 31), 'monthly')));
ok('the anchor is honoured when it is given',
   day(step(new Date(2026, 1, 28), 'monthly', 31)) === day(new Date(2026, 2, 31)),
   day(step(new Date(2026, 1, 28), 'monthly', 31)));
ok('a nonsense anchor is ignored rather than obeyed',
   day(step(new Date(2026, 1, 10), 'monthly', 99)) === day(new Date(2026, 2, 10)));

// ── Clocks going forward and back ──
//
// In Europe/London the clocks go forward on 29 March 2026 and back on 25
// October. A day is 23 hours across one and 25 across the other, so anything
// adding 86,400,000 milliseconds lands an hour out — and an hour out at half
// past eleven at night is a different day.
{
  const spring = step(new Date(2026, 2, 28, 23, 30), 'daily');
  ok('a daily task crossing the spring change stays on the next day',
     day(spring) === day(new Date(2026, 2, 29)) && spring.getHours() === 23,
     `${spring}`);
  const autumn = step(new Date(2026, 9, 24, 23, 30), 'daily');
  ok('and crossing the autumn change likewise',
     day(autumn) === day(new Date(2026, 9, 25)) && autumn.getHours() === 23,
     `${autumn}`);
  const weekly = step(new Date(2026, 2, 26, 19, 0), 'weekly');
  ok('a weekly task keeps its hour across the change',
     weekly.getHours() === 19 && day(weekly) === day(new Date(2026, 3, 2)), `${weekly}`);
}

// ── The next date ──
ok('a task that does not repeat has no next date', nextDate(task('2026-05-10T09:00:00.000Z')) === null);

{
  // Due on Friday, ticked off on Sunday. The next one is the following Friday,
  // not the following Sunday: otherwise every late week drags the series later
  // and a month of those moves a Friday bill to a Wednesday.
  const friday = new Date(2026, 4, 8, 9, 0);
  const sunday = new Date(2026, 4, 10, 11, 0);
  const next = nextDate(task(friday.toISOString(), { repeat: 'weekly' }), sunday);
  ok('a late tick does not drag the series later',
     day(next) === day(new Date(2026, 4, 15)), day(next));
}

{
  // Ignored for five weeks. One task comes back, not five.
  const longAgo = new Date(2026, 3, 3, 9, 0);
  const now = new Date(2026, 4, 11, 9, 0);
  const next = nextDate(task(longAgo.toISOString(), { repeat: 'weekly' }), now);
  ok('a long-ignored task skips to the next one still ahead',
     next > now && day(next) === day(new Date(2026, 4, 15)), day(next));
}

{
  // Ticked off early, before it was even due: the next one is still the one
  // after the date it had, not the one after today.
  const due = new Date(2026, 4, 20, 9, 0);
  const now = new Date(2026, 4, 11, 9, 0);
  const next = nextDate(task(due.toISOString(), { repeat: 'monthly' }), now);
  ok('ticking it off early keeps the following date',
     day(next) === day(new Date(2026, 5, 20)), day(next));
}

{
  // A task nobody dated. "Every week" can only mean from today.
  const now = new Date(2026, 4, 11, 9, 0);
  const undated = { title: 'x', repeat: 'weekly', createdAt: now.toISOString(), dueDate: now.toISOString() };
  ok('a task with no date of its own counts from today',
     day(nextDate(undated, now)) === day(new Date(2026, 4, 18)), day(nextDate(undated, now)));
}

// ── What comes back ──
{
  const original = task(new Date(2026, 4, 8, 9, 0).toISOString(), {
    repeat: 'weekly',
    title: 'Pay the window cleaner',
    notes: 'Cash, through the letterbox',
    priority: 'high',
    taskType: 'todo',
    section: 'todo',
    viewScope: 'week',
    owePerson: 'Mrs Kelly',
    projectId: 'p1',
    dueTime: '09:00',
    reminderEnabled: true,
    earlyReminderMinutes: 10,
    voiceNotes: ['data:audio/webm;base64,QUJD'],
    id: 'old-1',
    completed: true,
    order: 4096,
  });
  const next = nextOccurrence(original, new Date(2026, 4, 9, 9, 0));

  ok('what it is travels', next.title === 'Pay the window cleaner');
  ok('what you wrote about it travels', next.notes === 'Cash, through the letterbox');
  ok('how urgent it is travels', next.priority === 'high');
  ok('which column travels', next.taskType === 'todo' && next.section === 'todo');
  ok('which horizon travels', next.viewScope === 'week');
  ok('who it concerns travels', next.owePerson === 'Mrs Kelly');
  ok('which project travels', next.projectId === 'p1');
  ok('the time of day travels', next.dueTime === '09:00');
  ok('the reminder travels', next.reminderEnabled === true && next.earlyReminderMinutes === 10);
  ok('and the repeat itself travels', next.repeat === 'weekly');
  ok('it is due a week later', day(next.dueDate) === day(new Date(2026, 4, 15)), day(next.dueDate));

  // The recording does not. A voice note is about the one you just did, and
  // carrying it forward would put a fresh hundred kilobytes of audio in the
  // vault every week until it filled.
  ok('the recording does not travel', next.voiceNotes === undefined);
  ok('nor does the identity of the old one', next.id === undefined);
  ok('nor its place in the list', next.order === undefined);
  ok('and it does not arrive already done', next.completed === undefined);
}

ok('a task that does not repeat has nothing to follow it',
   nextOccurrence(task('2026-05-08T09:00:00.000Z')) === null);
ok('and neither does nothing', nextOccurrence(null) === null);

// ── Rent on the thirty-first, for a year ──
//
// The case the anchor exists for. February clamps to the 28th; without an
// anchor the chain would then sit on the 28th for ever, and one short month
// would quietly move the rent by three days for the rest of its life.
{
  let current = task(new Date(2026, 0, 31, 9, 0).toISOString(), { repeat: 'monthly' });
  const landed = [];
  for (let i = 0; i < 12; i += 1) {
    const now = new Date(current.dueDate);
    now.setDate(now.getDate() + 1);
    const next = nextOccurrence(current, now);
    landed.push(new Date(next.dueDate).getDate());
    current = { ...next, createdAt: now.toISOString() };
  }
  ok('the rent lands on the 31st wherever the month allows it',
     landed.filter(d => d === 31).length >= 6, landed.join(','));
  ok('and on the last day of the month where it does not',
     landed.every(d => d >= 28), landed.join(','));
  ok('never drifting to the 28th and staying there',
     landed.filter(d => d === 28).length <= 1, landed.join(','));
  ok('the anchor is carried, not recomputed from the clamped date',
     current.repeatDay === 31, String(current.repeatDay));
}

// A monthly task in the middle of the month needs no anchor to behave.
{
  const mid = task(new Date(2026, 0, 15, 9, 0).toISOString(), { repeat: 'monthly' });
  const next = nextOccurrence(mid, new Date(2026, 0, 16, 9, 0));
  ok('a mid-month monthly task simply moves a month',
     day(next.dueDate) === day(new Date(2026, 1, 15)), day(next.dueDate));
  ok('and records what day it is anchored to', next.repeatDay === 15);
}

// Daily and weekly have no anchor to keep.
{
  const daily = task(new Date(2026, 4, 8, 9, 0).toISOString(), { repeat: 'daily' });
  const next = nextOccurrence(daily, new Date(2026, 4, 8, 20, 0));
  ok('a daily task carries no month anchor', next.repeatDay === undefined);
  ok('and is due tomorrow', day(next.dueDate) === day(new Date(2026, 4, 9)), day(next.dueDate));
}

// ── It has to stop ──
//
// A daily task abandoned for years is the worst thing anybody could contrive.
// It has to come back with a date, in reasonable time, rather than spinning.
{
  const abandoned = task(new Date(2016, 0, 1, 9, 0).toISOString(), { repeat: 'daily' });
  const now = new Date(2026, 4, 11, 9, 0);
  const began = Date.now();
  const next = nextDate(abandoned, now);
  ok('a task abandoned for a decade still answers', !!next);
  ok('and quickly', Date.now() - began < 500, `${Date.now() - began}ms`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
