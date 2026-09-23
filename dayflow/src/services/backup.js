// A copy of everything, in a file you keep.
//
// DayFlow encrypts your tasks with a key derived from your master password, and
// nothing anywhere can recover that password — not the server, which holds only
// ciphertext, and not me. That is the point of it. It also means the vault is
// one forgotten password, one cleared browser or one corrupted write away from
// being unreadable forever, and until now the app offered no way to keep a copy
// of what was inside it. The source code has been backed up; the tasks never
// had been.
//
// So this builds the whole of it — open tasks, completed ones, archived ones,
// projects, notes and the recordings themselves — as one plain file. Two things
// follow from that and are deliberate:
//
// It is not encrypted. A backup you cannot open without the password you lost
// is not a backup. It is therefore as readable as the vault is not, and the
// file says so about itself, because somebody opening it in a year should not
// have to guess.
//
// It keeps the fields exactly as they are stored rather than prettying them
// into something friendlier. Renaming them would make the file nicer to read
// and impossible to restore from without a translation nobody has written yet.
// Fidelity is the job.
//
// Pure: no storage, no React, no file system. What to do with the text is
// saveFile's problem.

import { notesOf } from './voiceNotes.js';

// Bumped only if the shape changes in a way something reading an older file
// would have to know about. A reader can then refuse a file from the future
// rather than misread it.
export const FORMAT = 1;

const WHAT_THIS_IS =
  'A complete copy of one DayFlow account, exported from the app. ' +
  'It is not encrypted — keep it somewhere you would keep a password. ' +
  'Voice notes are included as data: URIs, which is why the file is large.';

// Every record, each of them once.
//
// The rule is to lose nothing. A record with no id cannot be de-duplicated and
// could not be restored on its own, but it is still somebody's task, and the
// only way it exists at all is a vault that has gone wrong — which is precisely
// when a copy matters. It is kept, at the end. What is dropped is what was
// never a record: nulls, strings, holes in the list.
function collect(records) {
  const identified = new Map();
  const loose = [];
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const id = record.id;
    if (id === undefined || id === null || id === '') {
      loose.push(record);
      continue;
    }
    // Later wins: the archived list and the live list can hold the same task
    // for a moment after archiving, and the second one is the newer.
    identified.set(String(id), record);
  }
  return [...identified.values(), ...loose];
}

// Oldest first, which is the order they happened in and the order anybody
// reading the file will expect.
function inOrder(records) {
  return [...records].sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export function countOf(tasks) {
  let open = 0, completed = 0, archived = 0, owed = 0, voiceNotes = 0;
  for (const task of tasks) {
    if (task.archivedAt) archived += 1;
    else if (task.completed) completed += 1;
    else open += 1;
    if (task.taskType === 'done_for_me') owed += 1;
    voiceNotes += notesOf(task).length;
  }
  return { total: tasks.length, open, completed, archived, owed, voiceNotes };
}

export function buildBackup({
  tasks = [], archived = [], projects = [], email = '', now = new Date(),
} = {}) {
  const everything = inOrder(collect([...tasks, ...archived]));
  const counts = countOf(everything);
  return {
    app: 'DayFlow',
    format: FORMAT,
    exportedAt: now.toISOString(),
    account: email || null,
    whatThisIs: WHAT_THIS_IS,
    counts: { ...counts, projects: collect(projects).length },
    projects: inOrder(collect(projects)),
    tasks: everything,
  };
}

// Indented rather than minified. The file exists to be readable by a person who
// no longer has the app, and the difference in size is nothing next to the
// recordings inside it.
export function backupText(backup) {
  return JSON.stringify(backup, null, 2);
}

export function backupFilename(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `dayflow-${day}.json`;
}

// How big it actually is, not how many characters it has. A title in any
// language outside ASCII costs more bytes than letters, and voice notes make
// the number worth showing at all.
export function byteSize(text) {
  if (typeof text !== 'string') return 0;
  const Encoder = globalThis.TextEncoder;
  if (typeof Encoder === 'function') return new Encoder().encode(text).length;
  return text.length;
}

export function humanSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// What to say once it has been written. The count is the part that reassures;
// the size is the part that explains why it took a moment.
export function describe(backup, text) {
  const { total, archived, voiceNotes } = backup.counts;
  const parts = [`${total} task${total === 1 ? '' : 's'}`];
  if (archived) parts.push(`${archived} archived`);
  if (voiceNotes) parts.push(`${voiceNotes} voice note${voiceNotes === 1 ? '' : 's'}`);
  parts.push(humanSize(byteSize(text)));
  return parts.join(' · ');
}
