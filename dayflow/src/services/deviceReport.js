// What this device is actually holding.
//
// There is already a way to ask what the server has. This is the other half,
// and it exists because of a bug that could not be found from the outside: a
// voice note recorded on a phone, saved, and then gone — from the phone as well
// as from everywhere else. Every explanation for that is a guess until somebody
// can see whether the note ever reached the drawer.
//
// So the numbers here are read back from storage rather than from the list on
// screen, and both are reported. What is in front of you is memory; what
// survives a relaunch is what was written. When those two disagree, the saving
// is the thing that is broken, and no amount of reasoning about sync will find
// it. When they agree, the saving is fine and the loss is somewhere later.
//
// Pure: no storage, no React. It is handed what was read and says what it
// means.

import { notesOf } from './voiceNotes.js';

export function bytesOf(text) {
  return typeof text === 'string' ? text.length : 0;
}

// Sizes a person can hold in their head. Exact bytes below a kilobyte, because
// at that size the number is the interesting part.
export function sizeWords(bytes) {
  const n = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// The voice notes on a list of tasks, and what they weigh.
//
// Counted from the notes themselves rather than from a field, because a note
// that is a path rather than the recording is the other thing worth spotting
// here: it costs nothing and it plays nowhere else.
export function notesIn(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  let count = 0;
  let bytes = 0;
  let references = 0;
  for (const task of list) {
    for (const uri of notesOf(task)) {
      count += 1;
      bytes += bytesOf(uri);
      if (!uri.startsWith('data:')) references += 1;
    }
  }
  return { count, bytes, references };
}

// Where dictation comes from on this device, in words.
//
// The four answers are not interchangeable and the difference between the last
// two is the one that matters: a build that does not carry the module and a
// build that carries a module offering nothing look the same from the outside —
// no button — and are fixed in completely different ways.
const DICTATION = {
  browser: 'Dictation comes from this browser',
  device: 'Dictation comes from this device',
  'no-browser-engine': 'This browser has no dictation',
  'not-in-this-build': 'Dictation is not in this build',
  'no-engine-in-module': 'Dictation is in this build but offers no engine',
};

export function dictationLine(source) {
  return DICTATION[source] || '';
}

// The phone's calendar, when reading it went wrong rather than coming back
// empty. Those two are not the same and used to look identical: a refused
// permission and a module whose functions had been renamed both produced no
// diary and no complaint.
export function calendarTroubleLine(trouble) {
  const said = typeof trouble === 'string' ? trouble.trim() : '';
  return said ? `The calendar on this device could not be read — ${said}` : '';
}

// What the two sides hold, and whether they agree.
//
// `stored` is what came back out of storage; `memory` is the list the app is
// drawing from. Everything else follows from those two.
export function summarise({ stored = [], memory = [], vaultBytes = 0, calendarBytes = 0 } = {}) {
  const onDisk = notesIn(stored);
  const inMemory = notesIn(memory);
  return {
    stored: { tasks: stored.length, ...onDisk },
    memory: { tasks: memory.length, ...inMemory },
    vaultBytes,
    calendarBytes,
    // The one question this was built to answer.
    agrees: stored.length === memory.length && onDisk.count === inMemory.count,
  };
}

// The report, in the app's own voice rather than as a table of fields.
//
// The disagreement, when there is one, is said first and said plainly. It is
// the only line here that means something is wrong, and burying it under three
// lines of sizes would be the same mistake as not reporting it at all.
export function deviceLines(summary) {
  if (!summary) return [];
  const { stored, memory, vaultBytes, calendarBytes, agrees } = summary;
  const lines = [];

  if (!agrees) {
    lines.push(
      `Not everything on screen has been saved — ${memory.tasks} ${
        memory.tasks === 1 ? 'task' : 'tasks'
      } and ${memory.count} ${
        memory.count === 1 ? 'recording' : 'recordings'
      } here, ${stored.tasks} and ${stored.count} written down.`
    );
  }

  lines.push(
    `${stored.tasks} ${stored.tasks === 1 ? 'task' : 'tasks'} written down, ${sizeWords(vaultBytes)}`
  );

  if (stored.count) {
    lines.push(
      `${stored.count} ${stored.count === 1 ? 'recording' : 'recordings'}, ${sizeWords(stored.bytes)}`
    );
  } else {
    lines.push('No recordings are stored on this device');
  }

  // A note that is not the recording itself is a note that plays nowhere but
  // here, which looks identical to a working one until you open the iPad.
  if (stored.references) {
    lines.push(
      `${stored.references} of them ${
        stored.references === 1 ? 'is a reference' : 'are references'
      } rather than the audio, and will not play on another device`
    );
  }

  if (calendarBytes) lines.push(`A calendar, ${sizeWords(calendarBytes)}`);

  return lines;
}
