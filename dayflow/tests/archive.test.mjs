// Archive tests: what happens to work you have finished with.
//
// The care is in one distinction — pressing delete on something finished should
// keep it, and on something unfinished should not. Pure logic. Run with
// `npm test`.

import { ARCHIVE, isArchived, deletionOf, sortArchive, groupByDay }
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
