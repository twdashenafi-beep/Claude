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

// What happened when the phone's calendar was last read, whatever it was.
//
// Four causes produce the same empty line under the date — refused, no
// calendars offered, the module's functions moved, or simply nothing in the
// diary — and they are fixed in four different places, one of them in iPhone
// Settings rather than in this app. Saying which is the difference between a
// setting somebody can change and a bug nobody can see.
export function calendarLine(reading) {
  const said = typeof reading === 'string' ? reading.trim() : '';
  return said ? `The calendar on this device: ${said}` : '';
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

// Which copy of DayFlow this is, in one line for the foot of the settings.
//
// The question it answers is not "what version am I on" but "am I looking at
// the web app or the installed one", because that is the fork that decides
// whether a missing change is a stale cache or a build that was never made.
// So the platform is said first and the number second.
export function buildLine(info) {
  const it = info || {};
  const web = it.platform === 'web' || !it.platform;

  if (web) {
    const stamp = String(it.stamp || '').trim();
    // The export script stamps the build; running from source does not, and
    // saying "build dev" invites somebody to go looking for build dev.
    return stamp && stamp !== 'dev' ? `Web app · build ${stamp}` : 'Web app · built from source';
  }

  const version = String(it.version || '').trim();
  const build = String(it.build || '').trim();
  if (version && build) return `Installed app · ${version} (${build})`;
  if (version) return `Installed app · ${version}`;
  // Better than a number nobody can check: TestFlight lists the build, and an
  // app that cannot read its own is a fact worth seeing rather than hiding.
  return 'Installed app · build unknown';
}

// Why the last sync failed, where somebody can read it.
//
// The page says "sync failed — will retry", which is the right thing for a
// page to say: it is context, not an incident. But the reason went to
// console.warn, which on a phone is nowhere — and those four words cover a
// row-level security rule, an expired session, a table that is not there and a
// train tunnel, all of which are fixed somewhere different.
export function syncLine(state, fault) {
  if (state !== 'error') return '';
  const said = String(fault || '').trim();
  return said ? `The last sync failed: ${said}` : 'The last sync failed, and said no reason why';
}

// Whether the microphone was ever allowed, which is not the same question as
// whether there is an engine here.
//
// "Dictation comes from this device" was being read as "the microphone works",
// and on a phone where permission had been refused it was both true and
// useless. The two answers sit side by side now, because they are fixed in
// different places: one by a build, the other in iOS Settings.
const LISTENING = {
  granted: 'and this device has been allowed to listen',
  refused: 'but this device is not allowed to listen — allow DayFlow the microphone and speech recognition in Settings',
  unasked: 'and it has not been asked for the microphone yet',
};

export function listeningLine(permission) {
  return LISTENING[permission] || '';
}

// What to say when dictation stops badly.
//
// The five codes below had sentences and every other code had nothing, so a
// microphone that failed for any other reason stopped silently and the button
// looked broken. That is the shape of fault that has cost this project more
// time than any other: a thing that does not work and does not say so.
//
// Two codes stay quiet on purpose. 'aborted' is this component being taken off
// the page, and 'no-speech' is a quiet room — neither is news.
//
// Anything else is named, with the code quoted as the phone gave it. An
// unfamiliar code in quotation marks is not elegant, but it is something a
// person can repeat to somebody who can act on it, and silence is not.
const SPEECH_TROUBLE = {
  'not-allowed': 'Microphone blocked — allow it in Settings',
  'service-not-allowed': 'Speech recognition is blocked — allow it in Settings',
  'audio-capture': 'No microphone found',
  network: 'Dictation needs a connection',
  'language-not-supported': 'Dictation is not available for this language',
};

const QUIET_CODES = new Set(['aborted', 'no-speech']);

export function speechTrouble(code) {
  const said = String(code || '').trim();
  if (!said || QUIET_CODES.has(said)) return '';
  return SPEECH_TROUBLE[said] || `Dictation stopped — the phone said “${said}”`;
}
