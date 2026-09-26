// The day, briefed.
//
// The same four shapes as the Friday page, asked of a morning instead of a
// week. The rules that matter are the ones about what does NOT belong: a task
// nobody dated is not late, and something another person owes you is not also
// one of today's jobs.
//
// Run with `npm test`.
import { brief, headline, finishedNote } from '../src/services/briefing.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// Friday 2 October 2026, mid-afternoon.
const NOW = new Date('2026-10-02T15:00:00');
const iso = (y, m, d, hh = 9, mm = 0) => new Date(y, m - 1, d, hh, mm).toISOString();

const task = (extra = {}) => ({
  id: extra.id || Math.random().toString(36).slice(2),
  title: 'Something',
  taskType: 'todo',
  viewScope: 'week',
  createdAt: iso(2026, 9, 28),
  updatedAt: iso(2026, 9, 28),
  dueDate: iso(2026, 9, 28),
  ...extra,
});

// ── The four questions ──────────────────────────────────────────────────────
{
  const tasks = [
    // Dated before today and still open.
    task({ id: 'a', title: 'Pay the invoice', dueDate: iso(2026, 9, 30), dueTime: '09:00' }),
    task({ id: 'b', title: 'Sign the lease', dueDate: iso(2026, 10, 1), dueTime: '17:00' }),
    // Dated today.
    task({ id: 'c', title: 'Board call', dueDate: iso(2026, 10, 2), dueTime: '11:00' }),
    task({ id: 'd', title: 'Call the bank', dueDate: iso(2026, 10, 2), dueTime: '08:30' }),
    // On today's page with no date anybody chose.
    { id: 'e', title: 'Read the memo', taskType: 'todo', viewScope: 'day', order: 2,
      createdAt: iso(2026, 10, 2, 7), updatedAt: iso(2026, 10, 2, 7), dueDate: iso(2026, 10, 2, 7) },
    { id: 'f', title: 'Draft the note', taskType: 'todo', viewScope: 'day', order: 1,
      createdAt: iso(2026, 10, 2, 7), updatedAt: iso(2026, 10, 2, 7), dueDate: iso(2026, 10, 2, 7) },
    // Tomorrow.
    task({ id: 'g', title: 'Site visit', dueDate: iso(2026, 10, 3), dueTime: '10:00' }),
    // Next week: neither today nor tomorrow.
    task({ id: 'h', title: 'Quarterly review', dueDate: iso(2026, 10, 7), dueTime: '10:00' }),
    // Undated and not on today's page. It is nine days "past" a date nobody
    // chose, and must not be called late.
    { id: 'i', title: 'Someday thing', taskType: 'todo', viewScope: 'month',
      createdAt: iso(2026, 9, 23), updatedAt: iso(2026, 9, 23), dueDate: iso(2026, 9, 23) },
    // Owed, and long overdue by its own date.
    task({ id: 'j', title: 'The signed inventory', taskType: 'done_for_me',
           owePerson: 'Marchetti', createdAt: iso(2026, 9, 10),
           dueDate: iso(2026, 9, 14), dueTime: '09:00' }),
    task({ id: 'k', title: 'The deposit back', taskType: 'done_for_me',
           owePerson: 'Okafor', createdAt: iso(2026, 9, 24) }),
    // Finished, earlier today.
    task({ id: 'l', title: 'Approve the budget', completed: true, completedAt: iso(2026, 10, 2, 10) }),
    // Finished yesterday.
    task({ id: 'm', title: 'Old news', completed: true, completedAt: iso(2026, 10, 1, 10) }),
  ];
  const sum = brief(tasks, [], NOW);

  ok('what is late is what was dated before today', sum.late.length === 2,
     sum.late.map(t => t.title).join(', '));
  ok('oldest first, because that is the one that has been ignored longest',
     sum.late[0].id === 'a', sum.late.map(t => t.id).join(''));
  ok('a task nobody dated is not late', !sum.late.some(t => t.id === 'i'),
     sum.late.map(t => t.title).join(', '));

  // The one that would make the morning unreadable: an owed thing past its own
  // date is named under the person, not filed among your own failures.
  ok('what somebody else owes is not one of your late things',
     !sum.late.some(t => t.taskType === 'done_for_me'),
     sum.late.map(t => t.title).join(', '));

  ok('today is today\'s page and anything dated today', sum.today.length === 4,
     sum.today.map(t => t.title).join(', '));
  ok('read down the clock', sum.today[0].id === 'd' && sum.today[1].id === 'c',
     sum.today.map(t => t.id).join(''));
  ok('and the untimed ones follow, in the order you put them',
     sum.today[2].id === 'f' && sum.today[3].id === 'e',
     sum.today.map(t => t.id).join(''));
  ok('nothing from tomorrow has crept in', !sum.today.some(t => t.id === 'g'));

  ok('tomorrow is tomorrow', sum.tomorrow.length === 1 && sum.tomorrow[0].id === 'g',
     sum.tomorrow.map(t => t.title).join(', '));
  ok('and next week is not', !sum.tomorrow.some(t => t.id === 'h'));

  ok('what is still owed is counted', sum.waiting.length === 2);
  ok('oldest first', sum.waiting[0].id === 'j');
  ok('and the people are counted, not the tasks', sum.people === 2);

  ok('what was finished today is counted', sum.done.length === 1,
     sum.done.map(t => t.title).join(', '));
  ok('and yesterday\'s is not', !sum.done.some(t => t.id === 'm'));

  ok('the headline says the three figures',
     headline(sum) === '2 late  ·  4 today  ·  2 waiting on 2 people', headline(sum));
  ok('and what has been done is said underneath',
     finishedNote(sum) === '1 thing finished today', finishedNote(sum));
}

// ── A morning with nothing in it ────────────────────────────────────────────
{
  const sum = brief([], [], NOW);
  ok('an empty day briefs to nothing',
     sum.late.length === 0 && sum.today.length === 0 && sum.waiting.length === 0);
  ok('and says so plainly', headline(sum) === 'Nothing due, nothing late', headline(sum));
  ok('with nothing finished, nothing is claimed', finishedNote(sum) === null);
  ok('no tasks at all is survived', brief(null, null, NOW).today.length === 0);
  ok('and so is a list full of holes',
     brief([null, undefined, {}, { id: 'x', title: '  ' }], [], NOW).today.length === 0);
  ok('a clock that is not a clock briefs nothing', brief([], [], new Date('nope')) === null);
}

// ── The singulars ───────────────────────────────────────────────────────────
{
  const sum = brief([
    task({ id: 'p', title: 'One thing', viewScope: 'day' }),
    task({ id: 'q', title: 'The report', taskType: 'done_for_me', owePerson: 'Ada',
           createdAt: iso(2026, 9, 20) }),
    task({ id: 'r', title: 'Done', completed: true, completedAt: iso(2026, 10, 2, 9) }),
  ], [], NOW);
  ok('one person is a person, not people',
     headline(sum) === '1 today  ·  1 waiting on 1 person', headline(sum));
  ok('and with nothing late it is not mentioned', !headline(sum).includes('late'));
  ok('one thing finished is a thing', finishedNote(sum) === '1 thing finished today',
     finishedNote(sum));
}

// ── The archive is still today's work ───────────────────────────────────────
{
  const filed = task({ id: 'z', title: 'Filed already', completed: true,
                       completedAt: iso(2026, 10, 2, 9), archivedAt: iso(2026, 10, 2, 9) });
  ok('something finished and then filed still counts',
     brief([], [filed], NOW).done.length === 1);
  ok('and it counts once, not twice', brief([filed], [filed], NOW).done.length === 1);
  ok('but a filed task is not on today\'s page',
     brief([], [filed], NOW).today.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
