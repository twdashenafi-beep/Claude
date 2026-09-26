// The week, reckoned.
//
// Four figures the app already knew and had never put on one page: what got
// finished, what slipped, who is still holding something of yours, and what
// next week already has in it.
//
// The dates are the hard part and the reason this suite is long. A week is not
// seven times 86,400,000 milliseconds — twice a year one of those days is 23
// hours or 25 — and "this week" from a Sunday means the six days behind you,
// not the one ahead. Run under a fixed zone so a British clock change is a real
// clock change rather than a thing the test environment decides.
//
// Run with `npm test`.
import {
  reckon, headline, nudge, isReckoningDay, weekStart, finishedAt, waitedFor, byPerson,
} from '../src/services/reckoning.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// Friday 2 October 2026, mid-afternoon.
const FRI = new Date('2026-10-02T15:00:00');
const iso = (y, m, d, hh = 9, mm = 0) => new Date(y, m - 1, d, hh, mm).toISOString();

// ── Which days it belongs to ────────────────────────────────────────────────
ok('Friday is a reckoning day', isReckoningDay(new Date('2026-10-02T09:00:00')));
ok('and so is Saturday', isReckoningDay(new Date('2026-10-03T09:00:00')));
ok('and Sunday, which is when plenty of people close the week',
   isReckoningDay(new Date('2026-10-04T21:00:00')));
ok('Monday is not', !isReckoningDay(new Date('2026-10-05T09:00:00')));
ok('nor Tuesday', !isReckoningDay(new Date('2026-10-06T09:00:00')));
ok('nor Wednesday', !isReckoningDay(new Date('2026-10-07T09:00:00')));
ok('nor Thursday', !isReckoningDay(new Date('2026-10-08T09:00:00')));

// ── Where the week starts ───────────────────────────────────────────────────
{
  const from = weekStart(FRI);
  ok('the week starts on Monday', from.getDay() === 1, String(from));
  ok('at the start of it', from.getHours() === 0 && from.getMinutes() === 0, String(from));
  ok('which from a Friday is four days back', from.getDate() === 28, String(from));

  // The one everybody gets wrong: getDay puts Sunday first, so a naive
  // subtraction walks a Sunday forward into the week that has not happened.
  const sunday = weekStart(new Date('2026-10-04T21:00:00'));
  ok('and from a Sunday it is six days back, not one forward',
     sunday.getDate() === 28 && sunday.getMonth() === 8, String(sunday));

  const monday = weekStart(new Date('2026-10-05T00:30:00'));
  ok('a Monday is its own week start', monday.getDate() === 5, String(monday));

  // Britain puts the clocks back on 25 October 2026. A week counted in hours
  // from the Monday lands an hour inside the Sunday before.
  const afterChange = weekStart(new Date('2026-10-28T12:00:00'));
  ok('a clock change does not move the Monday',
     afterChange.getDay() === 1 && afterChange.getDate() === 26, String(afterChange));
  ok('and it is still midnight', afterChange.getHours() === 0, String(afterChange));

  ok('nonsense has no week', weekStart(new Date('nope')) === null);
}

// ── When a task was finished ────────────────────────────────────────────────
{
  ok('an open task was not finished', finishedAt({ completed: false, completedAt: iso(2026, 10, 1) }) === null);
  ok('a finished one says when', finishedAt({ completed: true, completedAt: iso(2026, 10, 1) }).getDate() === 1);

  // Written before completedAt existed. The archive stamp is the next best
  // record, and updatedAt the one after that.
  ok('an older one falls back to when it was filed',
     finishedAt({ completed: true, archivedAt: iso(2026, 9, 30) }).getDate() === 30);
  ok('and then to when it was last touched',
     finishedAt({ completed: true, updatedAt: iso(2026, 9, 29) }).getDate() === 29);
  ok('the newest field wins over the fallbacks',
     finishedAt({ completed: true, completedAt: iso(2026, 10, 1), updatedAt: iso(2026, 10, 2) }).getDate() === 1);
  ok('junk in the field is not a date',
     finishedAt({ completed: true, completedAt: 'soon' }) === null);
}

// ── The week itself ─────────────────────────────────────────────────────────
const task = (extra = {}) => ({
  id: extra.id || Math.random().toString(36).slice(2),
  title: 'Something',
  taskType: 'todo',
  createdAt: iso(2026, 9, 28),
  updatedAt: iso(2026, 9, 28),
  dueDate: iso(2026, 9, 28),
  ...extra,
});

{
  const tasks = [
    task({ id: 'a', title: 'Signed the lease', completed: true, completedAt: iso(2026, 9, 29) }),
    task({ id: 'b', title: 'Board pack', completed: true, completedAt: iso(2026, 10, 2, 11) }),
    // Finished on the Friday before: last week's work, not this week's.
    task({ id: 'c', title: 'Old thing', completed: true, completedAt: iso(2026, 9, 25) }),
    // Dated and gone by.
    task({ id: 'd', title: 'Pay the invoice', dueDate: iso(2026, 9, 30), dueTime: '09:00' }),
    // Dated and still ahead, inside next week.
    task({ id: 'e', title: 'Quarterly review', dueDate: iso(2026, 10, 7), dueTime: '10:00' }),
    // Dated the week after next: too far out to be next week's problem.
    task({ id: 'f', title: 'Far off', dueDate: iso(2026, 10, 20), dueTime: '10:00' }),
    // Undated: created and never given a date, so its dueDate is the stamp the
    // app put there. It must not count as slipped, or half the app would.
    { id: 'g', title: 'No date on this', taskType: 'todo',
      createdAt: iso(2026, 9, 21), updatedAt: iso(2026, 9, 21), dueDate: iso(2026, 9, 21) },
    task({ id: 'h', title: 'The signed inventory', taskType: 'done_for_me',
           owePerson: 'Marchetti', createdAt: iso(2026, 9, 10) }),
    task({ id: 'i', title: 'The meter reading', taskType: 'done_for_me',
           owePerson: 'Marchetti', createdAt: iso(2026, 9, 18), chases: [iso(2026, 9, 29)] }),
    task({ id: 'j', title: 'The deposit back', taskType: 'done_for_me',
           owePerson: 'Okafor', createdAt: iso(2026, 9, 24) }),
    // Owed and already arrived.
    task({ id: 'k', title: 'The keys', taskType: 'done_for_me', owePerson: 'Okafor',
           completed: true, completedAt: iso(2026, 9, 30) }),
  ];
  const sum = reckon(tasks, [], FRI);

  ok('what was finished this week is counted', sum.done.length === 3,
     sum.done.map(t => t.title).join(', '));
  ok('and last week\'s is not', !sum.done.some(t => t.id === 'c'),
     sum.done.map(t => t.title).join(', '));
  ok('newest finished first, because that is how a week is read back',
     sum.done[0].id === 'b', sum.done.map(t => t.id).join(''));

  ok('what slipped is what is dated and gone', sum.slipped.length === 1,
     sum.slipped.map(t => t.title).join(', '));
  ok('and it is the right one', sum.slipped[0].id === 'd');
  ok('a task nobody dated has not slipped', !sum.slipped.some(t => t.id === 'g'));
  ok('nor has one that is still ahead', !sum.slipped.some(t => t.id === 'e'));

  ok('what is still owed is counted', sum.waiting.length === 3,
     sum.waiting.map(t => t.title).join(', '));
  ok('what has arrived is not', !sum.waiting.some(t => t.id === 'k'));
  ok('oldest first', sum.waiting[0].id === 'h', sum.waiting.map(t => t.id).join(''));
  ok('and the people are counted, not the tasks', sum.people === 2, String(sum.people));

  // The inventory has been owed since 10 September and its date is long gone.
  // It belongs to the person holding it, not to a second list of the week's
  // failures: counted in both, the week reads worse than it went.
  ok('what somebody else owes is not also counted as slipped',
     !sum.slipped.some(t => t.taskType === 'done_for_me'),
     sum.slipped.map(t => t.title).join(', '));
  ok('though it is still named under the person',
     sum.waiting.some(t => t.id === 'h'));

  ok('next week is next week', sum.ahead.length === 1, sum.ahead.map(t => t.title).join(', '));
  ok('and the week after is not', !sum.ahead.some(t => t.id === 'f'));
  ok('nor is anything already gone by', !sum.ahead.some(t => t.id === 'd'));

  ok('the headline says all three figures',
     headline(sum) === '3 done  ·  1 slipped  ·  3 waiting on 2 people', headline(sum));
  ok('the nudge is shorter and still honest',
     nudge(sum) === 'The week: 3 done, 1 slipped', nudge(sum));
}

// ── The archive is still this week's work ───────────────────────────────────
{
  const filed = task({ id: 'z', title: 'Filed already', completed: true,
                       completedAt: iso(2026, 9, 30), archivedAt: iso(2026, 9, 30) });
  const sum = reckon([], [filed], FRI);
  ok('something finished and then filed still counts', sum.done.length === 1);

  // The live list and the archive both hold a task for a moment after filing.
  const both = reckon([filed], [filed], FRI);
  ok('and it counts once, not twice', both.done.length === 1, String(both.done.length));
}

// ── A quiet week ────────────────────────────────────────────────────────────
{
  const sum = reckon([], [], FRI);
  ok('an empty week reckons to nothing', sum.done.length === 0 && sum.slipped.length === 0);
  ok('and says so plainly', headline(sum) === 'Nothing done, nothing slipped', headline(sum));
  ok('the nudge does not invent news', nudge(sum) === 'The week: 0 done', nudge(sum));
  ok('no tasks at all is survived', reckon(null, null, FRI).done.length === 0);
  ok('and so is a list full of holes',
     reckon([null, undefined, {}, { id: 'x', title: '  ' }], [], FRI).done.length === 0);
}

// ── One done, one slipped: the singulars ────────────────────────────────────
{
  const sum = reckon([
    task({ id: 'p', title: 'One thing', completed: true, completedAt: iso(2026, 9, 30) }),
    task({ id: 'q', title: 'The report', taskType: 'done_for_me', owePerson: 'Ada',
           createdAt: iso(2026, 9, 20) }),
  ], [], FRI);
  ok('one person is a person, not people',
     headline(sum) === '1 done  ·  1 waiting on 1 person', headline(sum));
  ok('and with nothing slipped it is not mentioned', !headline(sum).includes('slipped'));
  ok('nor by the nudge', nudge(sum) === 'The week: 1 done', nudge(sum));
}

// ── How long it has been waiting ────────────────────────────────────────────
ok('asked today says so', waitedFor({ createdAt: iso(2026, 10, 2, 8) }, FRI) === 'asked today');
ok('yesterday has its own word',
   waitedFor({ createdAt: iso(2026, 10, 1, 8) }, FRI) === 'asked yesterday',
   waitedFor({ createdAt: iso(2026, 10, 1, 8) }, FRI));
ok('and longer than that is a span',
   /^asked .+ ago$/.test(waitedFor({ createdAt: iso(2026, 9, 10) }, FRI)),
   waitedFor({ createdAt: iso(2026, 9, 10) }, FRI));
ok('no date, nothing said', waitedFor({}, FRI) === '');

// ── Gathered under the person ───────────────────────────────────────────────
{
  const waiting = [
    task({ id: 'h', title: 'The signed inventory', taskType: 'done_for_me',
           owePerson: 'Marchetti', createdAt: iso(2026, 9, 10) }),
    task({ id: 'j', title: 'The deposit back', taskType: 'done_for_me',
           owePerson: 'Okafor', createdAt: iso(2026, 9, 24) }),
    task({ id: 'i', title: 'The meter reading', taskType: 'done_for_me',
           owePerson: ' marchetti ', createdAt: iso(2026, 9, 18),
           chases: [iso(2026, 9, 29), iso(2026, 10, 1)] }),
  ];
  const groups = byPerson(waiting);

  ok('one group per person', groups.length === 2, String(groups.length));
  ok('however the name was typed', groups[0].tasks.length === 2,
     JSON.stringify(groups.map(g => g.person)));
  ok('the name is shown as it was first written', groups[0].person === 'Marchetti', groups[0].person);
  ok('the person kept waiting longest comes first', groups[0].person === 'Marchetti');
  ok('oldest first inside the group', groups[0].tasks[0].id === 'h');
  ok('and the chases are totalled', groups[0].chases === 2, String(groups[0].chases));
  ok('somebody never chased totals nothing', groups[1].chases === 0);
  ok('a nameless one is not a group', byPerson([task({ owePerson: '   ' })]).length === 0);
  ok('nothing owed is no groups', byPerson([]).length === 0 && byPerson(null).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
