// Project tests: a named place holding its own slice of the same task list.
//
// The care here is mostly about one thing — a task with no project, an empty
// project and a missing field all mean the main list, and if those three ever
// drift apart tasks start disappearing. Pure logic. Run with `npm test`.

import {
  PROJECT_KIND, EVERYTHING, projectOf, isProject, isTask,
  sortProjects, orderForNewProject, tasksInProject, projectName, cleanProjectName,
} from '../src/services/projects.js';
import { moveWithin } from '../src/services/ordering.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};
const ids = list => list.map(p => p.id).join(',');

// ── The three ways of saying "no project" ──
ok('a missing field means the main list', projectOf({ title: 'x' }) === EVERYTHING);
ok('null means the main list', projectOf({ projectId: null }) === EVERYTHING);
ok('an empty string means the main list', projectOf({ projectId: '' }) === EVERYTHING);
ok('a number is not a project id', projectOf({ projectId: 7 }) === EVERYTHING);
ok('no task at all is the main list', projectOf(undefined) === EVERYTHING);
ok('a real id is kept', projectOf({ projectId: 'p1' }) === 'p1');

// ── Telling projects from tasks ──
ok('a project record is a project', isProject({ kind: PROJECT_KIND }) === true);
ok('a task is not a project', isProject({ title: 'x' }) === false);
ok('a task is a task', isTask({ title: 'x' }) === true);
ok('a project is not a task', isTask({ kind: PROJECT_KIND }) === false);
ok('nothing is neither', isProject(null) === false && isTask(null) === false);

// ── Ordering ──
{
  const projects = [
    { id: 'c', order: 2, createdAt: '2026-01-01' },
    { id: 'a', order: 0, createdAt: '2026-01-02' },
    { id: 'b', order: 1, createdAt: '2026-01-03' },
  ];
  ok('projects sort by where they were put', ids(sortProjects(projects)) === 'a,b,c');
  ok('sorting does not mutate', ids(projects) === 'c,a,b');
}
{
  const noOrder = [
    { id: 'later', createdAt: '2026-02-01' },
    { id: 'earlier', createdAt: '2026-01-01' },
  ];
  ok('with no order, oldest first', ids(sortProjects(noOrder)) === 'earlier,later');
}
ok('a new project goes last', orderForNewProject([{ order: 0 }, { order: 4 }]) === 5);
ok('the first project starts at zero', orderForNewProject([]) === 0);
ok('projects with no order do not break the next one',
   orderForNewProject([{}, {}]) === 0);

// ── Slicing the task list ──
{
  const tasks = [
    { id: '1', title: 'loose' },
    { id: '2', title: 'kitchen', projectId: 'p1' },
    { id: '3', title: 'also loose', projectId: '' },
    { id: '4', title: 'garden', projectId: 'p2' },
  ];
  ok('the main list holds everything with no project',
     tasksInProject(tasks, EVERYTHING).map(t => t.id).join() === '1,3');
  ok('a project holds only its own', tasksInProject(tasks, 'p1').map(t => t.id).join() === '2');
  ok('an unknown project is empty', tasksInProject(tasks, 'nope').length === 0);
  ok('no project id means the main list', tasksInProject(tasks, null).map(t => t.id).join() === '1,3');
  // Every task belongs to exactly one place, or some become unreachable.
  const counted = ['', 'p1', 'p2'].reduce((n, id) => n + tasksInProject(tasks, id).length, 0);
  ok('every task lands in exactly one place', counted === tasks.length);
}

// ── Naming ──
{
  const projects = [{ id: 'p1', name: 'Kitchen' }];
  ok('a project is named', projectName(projects, 'p1') === 'Kitchen');
  ok('the main list is named too', projectName(projects, EVERYTHING) === 'Everything');
  ok('a deleted project falls back rather than showing blank',
     projectName(projects, 'gone') === 'Everything');
}

ok('a name is trimmed', cleanProjectName('  Kitchen  ').name === 'Kitchen');
ok('inner whitespace is collapsed', cleanProjectName('New   Kitchen').name === 'New Kitchen');
ok('an empty name is refused', cleanProjectName('   ').ok === false);
ok('a missing name is refused', cleanProjectName(undefined).ok === false);
ok('a very long name is capped', cleanProjectName('x'.repeat(80)).name.length === 40);
{
  const existing = [{ name: 'Kitchen' }];
  const clash = cleanProjectName('kitchen', existing);
  ok('a duplicate name is refused whatever its case', clash.ok === false);
  ok('and says which name clashed', /Kitchen/.test(clash.error));
  ok('a different name is fine', cleanProjectName('Garden', existing).ok === true);
}

// ── The states reordering will actually meet ──
//
// The tab bar writes an order that then syncs, so two devices reordering at
// once produce ties, an older project has no order at all, and a long session
// of dragging subdivides the gaps between values. None of that is hypothetical
// once the feature is in use.
{
  const P = (id, order, createdAt = '2026-01-01') => ({ id, name: id, kind: 'project', order, createdAt });
  const apply = (list, changes) => {
    const by = new Map(changes.map(c => [c.id, c.order]));
    return sortProjects(list.map(p => (by.has(p.id) ? { ...p, order: by.get(p.id) } : p)));
  };

  // Two devices reordering at once land on the same number.
  const tied = [P('a', 1, '2026-01-01'), P('b', 1, '2026-01-02'), P('c', 1, '2026-01-03')];
  ok('equal orders fall back to when they were made',
    sortProjects(tied).map(p => p.id).join() === 'a,b,c');
  ok('and sorting twice gives the same answer',
    sortProjects(sortProjects(tied)).map(p => p.id).join() === 'a,b,c');

  // A project made before ordering existed carries no order.
  const none = [{ id: 'x', name: 'x', createdAt: '2026-01-02' }, { id: 'y', name: 'y', createdAt: '2026-01-01' }];
  ok('projects with no order at all still sort', sortProjects(none).map(p => p.id).join() === 'y,x');
  ok('and can still be reordered',
    apply(none, moveWithin(sortProjects(none), 0, 1)).map(p => p.id).join() === 'x,y');

  // Dragging the same tab back and forth subdivides the gap each time.
  let list = [P('a', 0), P('b', 1), P('c', 2)];
  for (let i = 0; i < 60; i += 1) {
    list = apply(list, moveWithin(list, 2, 1));
    list = apply(list, moveWithin(list, 1, 2));
  }
  const orders = list.map(p => p.order);
  ok('sixty reorders do not collapse the order values',
    new Set(orders).size === orders.length, JSON.stringify(orders));
  ok('and the list keeps its length', list.length === 3);

  // A tab deleted on another device while this one is mid-drag.
  ok('moving from beyond the end changes nothing', moveWithin(list, 5, 0).length === 0);
  ok('moving to beyond the end changes nothing', moveWithin(list, 0, 9).length === 0);
  ok('a negative index changes nothing', moveWithin(list, -1, 0).length === 0);
  ok('an empty list changes nothing', moveWithin([], 0, 0).length === 0);

  // Anything at all in the order field, from a row written by a future version.
  for (const bad of [null, undefined, NaN, 'first', {}, Infinity, -Infinity]) {
    let threw = false;
    try { sortProjects([P('a', 0), { id: 'b', name: 'b', order: bad, createdAt: '2026-01-02' }]); }
    catch { threw = true; }
    ok(`an order of ${String(bad)} is survived`, !threw);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
