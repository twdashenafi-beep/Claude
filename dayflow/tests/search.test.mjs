// Search tests: finding a task you cannot remember filing.
//
// The whole feature is one judgement — what counts as a match, and which match
// to show first. Both are pure. Run with `npm test`.

import { normalizeQuery, excerpt, searchTasks, locationOf, RESULT_LIMIT }
  from '../src/services/search.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const task = (id, fields) => ({ id, title: id, updatedAt: '2026-01-01T00:00:00.000Z', ...fields });

// ── Reading what was typed ──
ok('case folds', normalizeQuery('LEASE') === 'lease');
ok('accents fold', normalizeQuery('Résumé') === 'resume');
ok('runs of space collapse', normalizeQuery('sign   the  lease') === 'sign the lease');
ok('surrounding space goes', normalizeQuery('  lease  ') === 'lease');
ok('nothing typed is empty', normalizeQuery('') === '');
ok('undefined is empty', normalizeQuery(undefined) === '');
ok('null is empty', normalizeQuery(null) === '');

// ── When it will answer at all ──
ok('one letter is too little', searchTasks([task('a', { title: 'lease' })], 'l').length === 0);
ok('two letters is enough', searchTasks([task('a', { title: 'lease' })], 'le').length === 1);
ok('space alone finds nothing', searchTasks([task('a', { title: 'lease' })], '   ').length === 0);
ok('no tasks is not an error', searchTasks(undefined, 'lease').length === 0);
ok('an empty list finds nothing', searchTasks([], 'lease').length === 0);

// ── What it looks at ──
{
  const tasks = [
    task('title', { title: 'Sign the lease' }),
    task('notes', { title: 'Call the agent', notes: 'ask about the lease break clause' }),
    task('person', { title: 'Deposit', owePerson: 'Lease & Co' }),
    task('nothing', { title: 'Buy milk', notes: 'semi-skimmed' }),
  ];
  const ids = searchTasks(tasks, 'lease').map(h => h.task.id);
  ok('a title matches', ids.includes('title'));
  ok('a note matches', ids.includes('notes'));
  ok('the person owed matches', ids.includes('person'));
  ok('an unrelated task does not', ids.includes('nothing') === false);
  ok('titles rank above people and notes', ids[0] === 'title');
  ok('the person owed ranks above notes', ids.indexOf('person') < ids.indexOf('notes'));
}

// ── Which field it says matched ──
{
  const hits = searchTasks([task('a', { title: 'Lease', notes: 'lease again' })], 'lease');
  ok('a task matching twice appears once', hits.length === 1);
  ok('the best field is the one reported', hits[0].field === 'title');
}

// ── Order among equals ──
{
  const tasks = [
    task('old', { title: 'lease one', updatedAt: '2026-01-01T00:00:00.000Z' }),
    task('new', { title: 'lease two', updatedAt: '2026-03-01T00:00:00.000Z' }),
  ];
  ok('the most recently touched comes first',
    searchTasks(tasks, 'lease').map(h => h.task.id).join() === 'new,old');
  ok('a missing date does not throw',
    searchTasks([task('x', { title: 'lease', updatedAt: undefined })], 'lease').length === 1);
}

// ── Accents and case, on the task rather than the query ──
{
  const tasks = [task('a', { title: 'Résumé draft' })];
  ok('an accented title is found unaccented', searchTasks(tasks, 'resume').length === 1);
  ok('an unaccented query in caps still finds it', searchTasks(tasks, 'RESUME').length === 1);
}

// ── The bit of a note that is shown ──
{
  const long = `${'a'.repeat(200)} lease clause ${'b'.repeat(200)}`;
  const cut = excerpt(long, 'lease');
  ok('the excerpt contains the match', cut.toLowerCase().includes('lease'));
  ok('the excerpt is short', cut.length < 120, `${cut.length}`);
  ok('an excerpt from the middle is elided at the front', cut.startsWith('…'));
  ok('an excerpt from the middle is elided at the end', cut.endsWith('…'));

  const short = excerpt('lease', 'lease');
  ok('a short note is shown whole', short === 'lease');
  ok('no elision when nothing is cut', short.includes('…') === false);
  ok('a note without the match still shows something', excerpt('nothing here', 'lease').length > 0);
  ok('an empty note is empty', excerpt('', 'lease') === '');
  ok('a missing note is empty', excerpt(undefined, 'lease') === '');
}

// ── Saying where the thing lives ──
ok('a day to-do says so', locationOf({ viewScope: 'day', taskType: 'todo' }) === 'Day  ·  To Do');
ok('a week owe-me says so',
  locationOf({ viewScope: 'week', taskType: 'done_for_me' }) === 'Week  ·  Owe Me');
ok('a month scope says so', locationOf({ viewScope: 'month' }).startsWith('Month'));
ok('a missing scope reads as Day', locationOf({ taskType: 'todo' }).startsWith('Day'));
ok('the project is named when there is one',
  locationOf({ viewScope: 'day', taskType: 'todo' }, 'Kitchen').endsWith('Kitchen'));
ok('no project adds nothing',
  locationOf({ viewScope: 'day', taskType: 'todo' }, '') === 'Day  ·  To Do');
ok('the archive replaces the scope',
  locationOf({ archivedAt: '2026-01-01', viewScope: 'week', taskType: 'todo' })
    === 'Archive  ·  To Do');
ok('finished work on the page is marked done',
  locationOf({ viewScope: 'day', taskType: 'todo', completed: true }).endsWith('done'));
ok('archived work is not also marked done',
  locationOf({ archivedAt: '2026-01-01', taskType: 'todo', completed: true })
    .includes('done') === false);
ok('nothing at all is empty', locationOf(null) === '');

// ── Not mutating what it was handed ──
{
  const tasks = [task('b', { title: 'lease b' }), task('a', { title: 'lease a' })];
  searchTasks(tasks, 'lease');
  ok('the caller list keeps its order', tasks.map(t => t.id).join() === 'b,a');
}

ok('a query too short still reports a total', searchTasks([], 'l').total === 0);

// ── Not returning an unbounded list ──
{
  const many = Array.from({ length: 120 }, (_, i) =>
    task(`t${i}`, { title: `lease ${i}`, updatedAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` }));
  const hits = searchTasks(many, 'lease');
  ok('the list stops at the limit', hits.length === RESULT_LIMIT, String(hits.length));
  ok('but it says how many there really were', hits.total === 120, String(hits.total));
  ok('a short list reports its own length',
    searchTasks([task('a', { title: 'lease' })], 'lease').total === 1);
  ok('the ones kept are the ones that ranked highest',
    hits[0].task.updatedAt >= hits[hits.length - 1].task.updatedAt);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
