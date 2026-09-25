// Reading a copy back in.
//
// The dangerous half. An export runs against nothing and can only fail by being
// incomplete; an import runs against work that already exists, and its worst
// outcome is not failing — it is succeeding and quietly losing something.
//
// So the rule this is mostly checking is the one the module is arranged around:
// nothing in the vault is ever removed. A task that is here and not in the file
// stays exactly as it is, whatever else happens.
//
// Run with `npm test`.
import {
  readBackup, planRestore, recordsOf, describePlan,
} from '../src/services/restore.js';
import { buildBackup, backupText, FORMAT } from '../src/services/backup.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const task = (id, updatedAt, extra = {}) => ({
  id, title: `Task ${id}`, updatedAt, createdAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const ids = list => list.map(r => r.id).sort().join(',');

// ── What counts as a copy ──
ok('nothing is not a copy', readBackup('').ok === false);
ok('nor is whitespace', readBackup('   ').ok === false);
ok('nor is junk', readBackup('not json at all').ok === false);
ok('and it says so in words', /not even JSON/.test(readBackup('nope').error));
ok('an array is not a copy', readBackup('[]').ok === false);
ok('null is not a copy', readBackup('null').ok === false);
ok('somebody else’s JSON is not a copy',
   readBackup('{"tasks":[{"id":"1"}]}').ok === false);
ok('and neither is a copy of nothing',
   readBackup('{"app":"DayFlow","format":1}').ok === false);

// A file from a newer version may hold fields this one would drop on the way
// through. Refusing is the honest answer.
ok('a copy from the future is refused',
   readBackup(JSON.stringify({ app: 'DayFlow', format: FORMAT + 1, tasks: [] })).ok === false);
ok('and says why', /newer version/.test(
   readBackup(JSON.stringify({ app: 'DayFlow', format: FORMAT + 1, tasks: [] })).error));
ok('a copy with no format is refused',
   readBackup(JSON.stringify({ app: 'DayFlow', tasks: [] })).ok === false);

// The real thing, made by the exporter rather than by hand.
{
  const made = backupText(buildBackup({ tasks: [task('1', '2026-05-01T00:00:00.000Z')] }));
  const read = readBackup(made);
  ok('a copy this app wrote is read back', read.ok === true, JSON.stringify(read.error));
  ok('with its tasks in it', read.backup.tasks.length === 1);
}

// ── The rule: nothing is removed ──
{
  const backup = { app: 'DayFlow', format: 1, tasks: [task('a', '2026-01-01T00:00:00.000Z')] };
  const mine = [task('z', '2026-05-01T00:00:00.000Z'), task('y', '2026-05-01T00:00:00.000Z')];
  const plan = planRestore({ backup, tasks: mine });
  ok('a task here and not in the file is left alone',
     !recordsOf(plan).some(r => r.id === 'z' || r.id === 'y'), ids(recordsOf(plan)));
  ok('and the plan says so out loud', /Nothing is removed/.test(describePlan(plan)),
     describePlan(plan));
}

// ── Which version wins ──
{
  const backup = {
    app: 'DayFlow', format: 1,
    tasks: [
      task('older', '2026-01-01T00:00:00.000Z'),
      task('newer', '2026-09-01T00:00:00.000Z'),
      task('missing', '2026-01-01T00:00:00.000Z'),
    ],
  };
  const mine = [
    task('older', '2026-05-01T00:00:00.000Z'),
    task('newer', '2026-02-01T00:00:00.000Z'),
  ];
  const plan = planRestore({ backup, tasks: mine });
  ok('a task the file has a newer version of is updated', ids(plan.update) === 'newer');
  ok('a task this device has edited since is left as it is', plan.unchanged === 1);
  ok('and it is not in what would be written',
     !recordsOf(plan).some(r => r.id === 'older'), ids(recordsOf(plan)));
  ok('a task the device has never seen is added', ids(plan.add) === 'missing');
}

// Same timestamp on both sides is not newer, so it is left alone. Re-importing
// the same copy twice must do nothing the second time.
{
  const backup = { app: 'DayFlow', format: 1, tasks: [task('a', '2026-05-01T00:00:00.000Z')] };
  const plan = planRestore({ backup, tasks: [task('a', '2026-05-01T00:00:00.000Z')] });
  ok('the same copy twice changes nothing the second time',
     recordsOf(plan).length === 0 && plan.unchanged === 1, JSON.stringify(plan));
  ok('and the sentence says there is nothing to do',
     /Nothing in that copy is missing/.test(describePlan(plan)), describePlan(plan));
}

// ── Tasks this device deleted ──
//
// Importing a copy is a deliberate act and "put this back" is the only thing it
// can mean. The tombstone has to go with it or the next sync deletes it again,
// which is the same thing undo does after a delete.
{
  const backup = { app: 'DayFlow', format: 1, tasks: [task('gone', '2026-01-01T00:00:00.000Z')] };
  const plan = planRestore({ backup, tasks: [], tombstones: [{ id: 'gone' }] });
  ok('a task deleted here comes back', ids(plan.revive) === 'gone');
  ok('and is counted among what arrives', recordsOf(plan).length === 1);
  ok('it is not merely added, because the tombstone has to go too',
     plan.add.length === 0, ids(plan.add));
}

// ── Projects ──
{
  const backup = {
    app: 'DayFlow', format: 1,
    tasks: [task('t1', '2026-01-01T00:00:00.000Z')],
    projects: [{ id: 'p1', kind: 'project', name: 'Copper', updatedAt: '2026-01-01T00:00:00.000Z' }],
  };
  const plan = planRestore({ backup, tasks: [] });
  ok('projects come in as well as tasks', ids(plan.add) === 'p1,t1', ids(plan.add));
  ok('and a project already here is not duplicated', (() => {
    const second = planRestore({
      backup,
      tasks: [{ id: 'p1', kind: 'project', name: 'Copper', updatedAt: '2026-05-01T00:00:00.000Z' }],
    });
    return !recordsOf(second).some(r => r.id === 'p1');
  })());
}

// ── Junk in a file that is otherwise fine ──
{
  const backup = {
    app: 'DayFlow', format: 1,
    tasks: [null, 'nonsense', ['a'], { title: 'no id' }, { id: '' }, task('good', '2026-01-01T00:00:00.000Z')],
  };
  const plan = planRestore({ backup, tasks: [] });
  ok('records that cannot be identified are not brought in',
     ids(plan.add) === 'good', ids(plan.add));
}

// The same id twice in one file is one record, not two.
{
  const backup = {
    app: 'DayFlow', format: 1,
    tasks: [task('dup', '2026-01-01T00:00:00.000Z'), task('dup', '2026-02-01T00:00:00.000Z')],
  };
  const plan = planRestore({ backup, tasks: [] });
  ok('the same id twice in one file arrives once', recordsOf(plan).length === 1);
}

// ── Nothing at all ──
ok('an empty copy is survived', (() => {
  const plan = planRestore({ backup: { app: 'DayFlow', format: 1, tasks: [] }, tasks: [] });
  return recordsOf(plan).length === 0;
})());
ok('and so is no copy at all', (() => {
  const plan = planRestore({ backup: null, tasks: [] });
  return recordsOf(plan).length === 0;
})());
ok('and junk where the task list should be', (() => {
  const plan = planRestore({ backup: { app: 'DayFlow', format: 1, tasks: 'no' }, tasks: [] });
  return recordsOf(plan).length === 0;
})());

// ── What it says before it does anything ──
{
  const backup = {
    app: 'DayFlow', format: 1,
    tasks: [
      task('add1', '2026-01-01T00:00:00.000Z'),
      task('add2', '2026-01-01T00:00:00.000Z'),
      task('up', '2026-09-01T00:00:00.000Z'),
      task('same', '2026-01-01T00:00:00.000Z'),
    ],
  };
  const plan = planRestore({
    backup,
    tasks: [task('up', '2026-02-01T00:00:00.000Z'), task('same', '2026-01-01T00:00:00.000Z')],
  });
  const said = describePlan(plan);
  ok('it counts what would arrive', /2 to add/.test(said), said);
  ok('and what would move forward', /1 to bring up to date/.test(said), said);
  ok('and what is already here', /1 already here/.test(said), said);
  ok('and ends on the promise that matters', /Nothing is removed\.$/.test(said), said);
}

// ── A task with no timestamp at all ──
//
// Old records, or a file somebody has edited. It must not silently beat a real
// one: an unreadable date counts as the beginning of time.
{
  const backup = { app: 'DayFlow', format: 1, tasks: [{ id: 'a', title: 'No stamp' }] };
  const plan = planRestore({ backup, tasks: [task('a', '2026-05-01T00:00:00.000Z')] });
  ok('a record with no timestamp does not overwrite a real one',
     recordsOf(plan).length === 0, ids(recordsOf(plan)));

  const other = planRestore({ backup, tasks: [] });
  ok('but it is still brought in when nothing is there', ids(other.add) === 'a');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
