// Archive tests: what happens to work you have finished with.
//
// The care is in one distinction — pressing delete on something finished should
// keep it, and on something unfinished should not. Pure logic. Run with
// `npm test`.

import { ARCHIVE, isArchived, deletionOf, sortArchive, groupByDay, byAge, foldedLine, readyToFile }
  from '../src/services/archive.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// ── Recognising one ──
ok('a date filed means archived', isArchived({ archivedAt: '2026-09-04T10:00:00.000Z' }));
ok('no date means not archived', isArchived({ title: 'x' }) === false);
ok('an empty date does not count', isArchived({ archivedAt: '' }) === false);
ok('a non-string date does not count', isArchived({ archivedAt: 12345 }) === false);
ok('nothing at all is not archived', isArchived(undefined) === false);

// ── Which the button does ──
ok('deleting something finished keeps it', deletionOf({ completed: true }) === 'archive');
ok('deleting something unfinished removes it', deletionOf({ completed: false }) === 'delete');
ok('a task with no completed flag is removed', deletionOf({ title: 'x' }) === 'delete');
ok('nothing is removed rather than kept', deletionOf(undefined) === 'delete');

// ── Order ──
{
  const tasks = [
    { id: 'old', archivedAt: '2026-09-01T09:00:00.000Z' },
    { id: 'new', archivedAt: '2026-09-04T09:00:00.000Z' },
    { id: 'mid', archivedAt: '2026-09-02T09:00:00.000Z' },
  ];
  ok('newest is first', sortArchive(tasks).map(t => t.id).join() === 'new,mid,old');
  ok('sorting does not mutate', tasks.map(t => t.id).join() === 'old,new,mid');
  ok('an empty archive is fine', sortArchive([]).length === 0);
}

// ── Grouped by the day it was filed ──
{
  const tasks = [
    { id: 'a', archivedAt: '2026-09-04T09:00:00.000Z' },
    { id: 'b', archivedAt: '2026-09-04T17:00:00.000Z' },
    { id: 'c', archivedAt: '2026-09-01T12:00:00.000Z' },
  ];
  const groups = groupByDay(tasks);
  ok('one group per day', groups.length === 2);
  ok('newest day first', groups[0].day === '2026-09-04');
  ok('a day holds its own', groups[0].tasks.map(t => t.id).join() === 'b,a');
  ok('and the older day follows', groups[1].tasks.map(t => t.id).join() === 'c');
  ok('every task lands in a group',
     groups.reduce((n, g) => n + g.tasks.length, 0) === tasks.length);
  ok('a label can be supplied',
     groupByDay(tasks, d => `on ${d}`)[0].label === 'on 2026-09-04');
  ok('without one, the day is the label', groups[0].label === '2026-09-04');
}
ok('grouping an empty archive gives no groups', groupByDay([]).length === 0);
ok('the archive has a reserved name so a project cannot take it',
   ARCHIVE.startsWith('__'));

// ── A year is where a record stops being read and starts being stored ───────
//
// Nothing has ever left the archive, and the only way out was a cliff: EMPTY,
// all of it, for ever. Three hundred records become three thousand, and on the
// day the storage runs out the only tool is the one nobody wants to use.
//
// So a slope. Over a year old folds behind a line; still kept, still searched,
// still in the backup, still one tap away.
{
  const NOW = new Date(2026, 9, 6, 9, 0);
  const filed = days => {
    const d = new Date(NOW);
    d.setDate(d.getDate() - days);
    return { id: `d${days}`, title: `${days} days ago`, completed: true, archivedAt: d.toISOString() };
  };

  const { recent, older } = byAge([filed(1), filed(200), filed(364), filed(366), filed(900)], NOW);
  ok('this year stays on the page',
     recent.map(t => t.id).sort().join(',') === 'd1,d200,d364',
     recent.map(t => t.id).join(','));
  ok('and anything past a year folds away',
     older.map(t => t.id).sort().join(',') === 'd366,d900',
     older.map(t => t.id).join(','));

  // The boundary, both sides of it. A year less a day is this year.
  ok('a year less a day is not folded', byAge([filed(364)], NOW).older.length === 0);
  ok('and a year and a day is', byAge([filed(366)], NOW).older.length === 1);

  // Nothing is thrown away by splitting: the two halves are the whole.
  const all = [filed(1), filed(366), filed(900), filed(10)];
  const split = byAge(all, NOW);
  ok('the two halves account for everything',
     split.recent.length + split.older.length === all.length,
     `${split.recent.length} + ${split.older.length} of ${all.length}`);

  // A record with no date is more likely a bug in whatever wrote it than a task
  // from 2019, and folding it would hide the evidence.
  ok('a record with no date stays visible',
     byAge([{ id: 'x', title: 'x', completed: true }], NOW).recent.length === 1);
  ok('and so does one with a date nothing can read',
     byAge([{ id: 'y', title: 'y', completed: true, archivedAt: 'whenever' }], NOW).recent.length === 1);

  ok('a broken list is survived',
     byAge(null).recent.length === 0 && byAge([null, undefined]).recent.length === 0);

  // Said as a sentence, because a bare number beside a fold is not a reason to
  // open it.
  ok('the fold says how much is behind it',
     foldedLine(older) === '2 finished more than a year ago', String(foldedLine(older)));
  ok('and says nothing when there is nothing behind it', foldedLine([]) === null);
  ok('nor when asked about nothing at all', foldedLine(null) === null);
}

// ── Filing itself ───────────────────────────────────────────────────────────
//
// The only way into the archive was pressing the cross, or Clear all — a chore
// whose whole purpose is housekeeping. If the archive's value is safe clearing,
// the app can do the clearing.
{
  const NOW = new Date(2026, 9, 11, 9, 0);
  const done = (id, daysAgo, extra = {}) => ({
    id, title: id, completed: true, taskType: 'todo',
    completedAt: new Date(+NOW - daysAgo * 86400000).toISOString(),
    ...extra,
  });
  const ids = list => readyToFile(list, NOW).sort().join(',');

  ok('a week-old finished task files itself', ids([done('a', 8)]) === 'a');
  ok('and one finished this morning does not', ids([done('b', 0)]) === '');
  ok('nor one finished six days ago', ids([done('c', 6)]) === '');
  // The boundary, both sides.
  ok('a day under the week stays', ids([done('d', 6.9)]) === '');
  ok('and a day over it goes', ids([done('e', 7.1)]) === 'e');

  // Still open is still open, however long it has sat there. This is the whole
  // difference between filing and tidying up after somebody.
  ok('an unfinished task is never filed, however old',
     ids([{ id: 'open', title: 'open', completed: false, taskType: 'todo',
       updatedAt: new Date(2020, 0, 1).toISOString() }]) === '');
  ok('and one already filed is not filed again',
     ids([done('f', 40, { archivedAt: new Date(2026, 8, 1).toISOString() })]) === '');

  // Owe Me is exempt. A thing somebody owed you that you ticked is a different
  // record from a job you finished, and settling up is worth dismissing by hand.
  ok('a ticked Owe Me stays on the page',
     ids([done('owed', 40, { taskType: 'done_for_me' })]) === '');
  ok('while the work beside it files itself',
     ids([done('mine', 40), done('owed', 40, { taskType: 'done_for_me' })]) === 'mine');

  // A project is not a task.
  ok('a project is never filed',
     ids([{ id: 'p', kind: 'project', name: 'p', completed: true }]) === '');

  // completedAt is the honest answer; updatedAt is the fallback, and it is at
  // worst too recent — so an old task with no completedAt waits rather than
  // vanishing early.
  ok('a task with no completedAt falls back to when it was last touched',
     ids([{ id: 'g', title: 'g', completed: true, taskType: 'todo',
       updatedAt: new Date(+NOW - 30 * 86400000).toISOString() }]) === 'g');
  ok('and one with no dates at all is left alone rather than guessed at',
     ids([{ id: 'h', title: 'h', completed: true, taskType: 'todo' }]) === '');
  ok('as is one whose date cannot be read',
     ids([{ id: 'i', title: 'i', completed: true, taskType: 'todo', completedAt: 'whenever' }]) === '');

  ok('a broken list is survived',
     readyToFile(null, NOW).length === 0 && readyToFile([null, undefined], NOW).length === 0);
  ok('and a record with no id is not filed by its absence',
     ids([{ completed: true, taskType: 'todo', completedAt: new Date(2020, 0, 1).toISOString() }]) === '');

  // Several at once, which is what a first run after a week looks like.
  ok('everything ready goes together',
     ids([done('x', 9), done('y', 20), done('z', 1)]) === 'x,y');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
