// Project tests: a named place holding its own slice of the same task list.
//
// The care here is mostly about one thing — a task with no project, an empty
// project and a missing field all mean the main list, and if those three ever
// drift apart tasks start disappearing. Pure logic. Run with `npm test`.

import {
  PROJECT_KIND, EVERYTHING, projectOf, isProject, isTask,
  sortProjects, orderForNewProject, tasksInProject, projectName, cleanProjectName,
} from '../src/services/projects.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
