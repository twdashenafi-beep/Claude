// A copy of everything, in a file you keep.
//
// The vault is encrypted with a key derived from a password nothing can
// recover. That is the point of it, and it is also the reason this file has to
// be right: it is the only copy of your tasks that survives forgetting the
// password, and a backup is not checked when it is made — it is checked years
// later, by somebody who no longer has the app that wrote it.
//
// So what is tested here is mostly completeness. Anything quietly left out of
// the file is discovered at the worst possible moment.
//
// Run with `npm test`.
import {
  buildBackup, backupText, backupFilename, countOf, byteSize, humanSize, describe, FORMAT,
} from '../src/services/backup.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const NOW = new Date('2026-09-23T10:30:00Z');
const task = (id, extra = {}) => ({
  id: String(id), title: `Task ${id}`, createdAt: `2026-01-0${id}T09:00:00.000Z`, ...extra,
});

// ── Everything is in there ──
{
  const backup = buildBackup({
    tasks: [task(1), task(2, { completed: true })],
    archived: [task(3, { archivedAt: '2026-02-01T00:00:00.000Z', completed: true })],
    projects: [{ id: 'p1', kind: 'project', name: 'House', createdAt: '2025-12-01T00:00:00.000Z' }],
    email: 't@example.com',
    now: NOW,
  });

  ok('open tasks are in it', backup.tasks.some(t => t.id === '1'));
  ok('completed ones too', backup.tasks.some(t => t.id === '2'));
  ok('and archived ones, which is the half most easily forgotten',
     backup.tasks.some(t => t.id === '3'));
  ok('projects come along', backup.projects.length === 1);
  ok('it says which account it came from', backup.account === 't@example.com');
  ok('and when', backup.exportedAt === NOW.toISOString());
  ok('and what it is', typeof backup.whatThisIs === 'string' && backup.whatThisIs.length > 40);
  ok('it admits it is not encrypted', /not encrypted/i.test(backup.whatThisIs));
  ok('it carries a format number so a reader can refuse a newer one',
     backup.format === FORMAT);

  ok('the counts add up', backup.counts.total === 3, JSON.stringify(backup.counts));
  ok('open, completed and archived are counted apart',
     backup.counts.open === 1 && backup.counts.completed === 1 && backup.counts.archived === 1,
     JSON.stringify(backup.counts));
  ok('and the projects are counted', backup.counts.projects === 1);

  // Oldest first: the order they happened in.
  ok('tasks come out in the order they were made',
     backup.tasks.map(t => t.id).join('') === '123', backup.tasks.map(t => t.id).join(''));
}

// ── Fields are kept exactly as stored ──
//
// Renaming them into something friendlier would make the file nicer to read and
// impossible to restore from. Every field a task has must survive the trip.
{
  const full = {
    id: 'x1',
    title: 'Chase the deposit',
    taskType: 'done_for_me',
    person: 'Dereb',
    amount: 250,
    completed: false,
    notes: 'He said Friday',
    voiceNotes: ['data:audio/webm;base64,QUJD'],
    projectId: 'p1',
    dueDate: '2026-03-01T00:00:00.000Z',
    dueTime: '09:00',
    viewScope: 'week',
    priority: 'high',
    repeat: 'monthly',
    repeatDay: 31,
    order: 1024,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
  };
  const backup = buildBackup({ tasks: [full], now: NOW });
  const out = backup.tasks[0];
  const missing = Object.keys(full).filter(k => JSON.stringify(out[k]) !== JSON.stringify(full[k]));
  ok('every field of a task survives the trip', missing.length === 0, missing.join(', '));
  ok('including the recording itself, not a pointer to one',
     out.voiceNotes[0].startsWith('data:'));
  ok('and a voice note is counted', backup.counts.voiceNotes === 1);
}

// ── The same task in two lists is one task ──
//
// Archiving moves a task from one list to the other, and for a moment both hold
// it. A backup with the same task twice would restore as two.
{
  const live = task(9);
  const same = { ...live, archivedAt: '2026-03-01T00:00:00.000Z' };
  const backup = buildBackup({ tasks: [live], archived: [same], now: NOW });
  ok('a task in both lists appears once', backup.tasks.length === 1);
  ok('and it is the archived version, which is the newer',
     backup.tasks[0].archivedAt === '2026-03-01T00:00:00.000Z');
}

// ── Junk in, nothing out — but nothing real is lost either ──
//
// The rule is that a backup loses nothing. Things that were never records go;
// a record that has gone wrong stays, because the only way one exists is a
// vault that has gone wrong, which is exactly when the copy matters.
{
  const backup = buildBackup({
    tasks: [null, undefined, 'nonsense', ['a'], { title: 'no id' }, { id: '', title: 'empty id' }, task(4)],
    now: NOW,
  });
  const titles = backup.tasks.map(t => t.title).sort().join('|');
  ok('what was never a record is dropped', !/nonsense/.test(JSON.stringify(backup.tasks)),
     JSON.stringify(backup.tasks));
  ok('the real task is kept', backup.tasks.some(t => t.id === '4'));
  ok('and a damaged one is kept rather than quietly lost',
     /no id/.test(titles) && /empty id/.test(titles), titles);
}

// An id that is a number rather than a string is still an id. Nothing in the
// app makes one, but a backup is the wrong place to be fussy about types.
{
  const backup = buildBackup({ tasks: [{ id: 7, title: 'Numbered' }], now: NOW });
  ok('a numeric id is not a reason to drop a task', backup.tasks.length === 1,
     JSON.stringify(backup.tasks));
}

ok('an empty account still makes a valid file', (() => {
  const backup = buildBackup();
  return backup.tasks.length === 0 && backup.counts.total === 0 && backup.app === 'DayFlow';
})());
ok('and one with no account says so', buildBackup().account === null);

// ── The text ──
{
  const backup = buildBackup({ tasks: [task(1)], now: NOW });
  const text = backupText(backup);
  ok('the file is valid JSON', (() => { try { JSON.parse(text); return true; } catch { return false; } })());
  ok('and reads back as what went in', JSON.parse(text).tasks[0].title === 'Task 1');
  ok('indented, because a person may have to read it', text.includes('\n  "app"'));
}

// ── The name ──
ok('the file is named for the day it was made',
   backupFilename(new Date('2026-09-23T10:30:00')) === 'dayflow-2026-09-23.json',
   backupFilename(new Date('2026-09-23T10:30:00')));
ok('with months and days padded, so the names sort',
   backupFilename(new Date('2026-01-05T10:30:00')) === 'dayflow-2026-01-05.json',
   backupFilename(new Date('2026-01-05T10:30:00')));

// ── Counting ──
{
  const counts = countOf([
    { id: '1' },
    { id: '2', completed: true },
    { id: '3', archivedAt: 'x' },
    // Archived wins over completed: a task can be both, and it is in the
    // archive that you would go looking for it.
    { id: '4', archivedAt: 'x', completed: true },
    { id: '5', taskType: 'done_for_me' },
    { id: '6', voiceNotes: ['a', 'b'] },
    // The old single field still counts as a note.
    { id: '7', voiceNoteUri: 'c' },
  ]);
  ok('everything is counted once', counts.total === 7, JSON.stringify(counts));
  ok('archived beats completed', counts.archived === 2 && counts.completed === 1,
     JSON.stringify(counts));
  ok('what is owed is counted', counts.owed === 1);
  ok('voice notes are counted across both shapes', counts.voiceNotes === 3,
     String(counts.voiceNotes));
}

// ── Size ──
ok('size is bytes, not characters', byteSize('é') === 2, String(byteSize('é')));
ok('an empty string is nothing', byteSize('') === 0);
ok('and junk is nothing', byteSize(null) === 0);
ok('bytes read as bytes', humanSize(512) === '512 bytes');
ok('kilobytes as kilobytes', humanSize(2048) === '2 KB');
ok('megabytes to one decimal', humanSize(1.5 * 1024 * 1024) === '1.5 MB', humanSize(1.5 * 1024 * 1024));
ok('nonsense sizes say nothing', humanSize(NaN) === '');

// ── What it says afterwards ──
{
  const backup = buildBackup({
    tasks: [task(1), task(2)],
    archived: [task(3, { archivedAt: 'x' })],
    now: NOW,
  });
  const line = describe(backup, backupText(backup));
  ok('the line says how many and how big', /3 tasks/.test(line) && /bytes|KB|MB/.test(line), line);
  ok('and mentions the archived ones', /1 archived/.test(line), line);

  const one = buildBackup({ tasks: [task(1)], now: NOW });
  ok('one task is not "1 tasks"', /1 task\b/.test(describe(one, backupText(one))),
     describe(one, backupText(one)));

  const withNote = buildBackup({ tasks: [task(1, { voiceNotes: ['data:audio/webm;base64,QQ=='] })], now: NOW });
  ok('a voice note is mentioned, since it is why the file is large',
     /1 voice note\b/.test(describe(withNote, backupText(withNote))),
     describe(withNote, backupText(withNote)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
