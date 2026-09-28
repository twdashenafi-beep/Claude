// What this device is holding, and whether it agrees with what is on screen.
//
// The report exists for one question: did the recording ever reach the drawer?
// So the case that matters most here is the disagreement — a note in memory
// that is not in storage — because that is the shape of the bug it was built
// to find, and a report that stayed quiet about it would be worse than none.
//
// Run with `npm test`.

import {
  bytesOf, sizeWords, notesIn, summarise, deviceLines,
} from '../src/services/deviceReport.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const audio = (n = 100) => `data:audio/webm;base64,${'A'.repeat(n)}`;
const task = (id, notes) => ({ id, title: id, ...(notes ? { voiceNotes: notes } : null) });

// ── Sizes somebody can read ──
ok('bytes below a kilobyte are said exactly', sizeWords(840) === '840 bytes', sizeWords(840));
ok('kilobytes are rounded', sizeWords(2048) === '2 KB', sizeWords(2048));
ok('megabytes keep one decimal', sizeWords(1024 * 1024 * 1.25) === '1.3 MB', sizeWords(1024 * 1024 * 1.25));
ok('nothing is nothing, not NaN', sizeWords(undefined) === '0 bytes', sizeWords(undefined));
ok('and a negative size cannot be reported', sizeWords(-5) === '0 bytes', sizeWords(-5));
ok('bytesOf ignores what is not a string', bytesOf(null) === 0 && bytesOf(undefined) === 0);

// ── Counting recordings ──
{
  const list = [task('a', [audio(10)]), task('b'), task('c', [audio(20), audio(30)])];
  const found = notesIn(list);
  ok('every note on every task is counted', found.count === 3, String(found.count));
  ok('and what they weigh is added up', found.bytes > 60, String(found.bytes));
  ok('none of these is a reference', found.references === 0, String(found.references));
}

// A note that is a path rather than the audio. It costs nothing, it plays here,
// and it plays nowhere else — which is precisely the failure that looks like
// success until you open another device.
{
  const found = notesIn([task('a', ['file:///var/mobile/recording.m4a'])]);
  ok('a path is counted as a note', found.count === 1);
  ok('and called out as a reference', found.references === 1, String(found.references));
}

// The legacy single field still counts, because a task old enough to have one
// is still a task with a recording on it.
ok('the old single field is counted too',
   notesIn([{ id: 'x', voiceNoteUri: audio(10) }]).count === 1);

// ── The question it was built to answer ──
{
  const inMemory = [task('a', [audio(200)]), task('b')];
  const written = [task('a'), task('b')];
  const summary = summarise({ stored: written, memory: inMemory, vaultBytes: 4096 });

  ok('a recording on screen but not in storage is a disagreement', summary.agrees === false);

  const lines = deviceLines(summary);
  ok('and it is the first thing said', /has been saved/.test(lines[0]), lines[0]);
  ok('with both numbers in it, so it is not a riddle',
     /1 recording here/.test(lines[0]) && /0 written down/.test(lines[0]), lines[0]);
}

{
  const both = [task('a', [audio(200)]), task('b')];
  const summary = summarise({ stored: both, memory: both, vaultBytes: 4096 });
  ok('when they match, nothing is wrong', summary.agrees === true);
  const lines = deviceLines(summary);
  ok('and no alarm is raised', !lines.some(l => /has been saved/.test(l)), lines.join(' | '));
  ok('the tasks are still reported', /2 tasks written down/.test(lines[0]), lines[0]);
  ok('and so are the recordings', lines.some(l => /1 recording,/.test(l)), lines.join(' | '));
}

// A device holding nothing says so, rather than saying "0 recordings".
{
  const lines = deviceLines(summarise({ stored: [task('a')], memory: [task('a')], vaultBytes: 900 }));
  ok('no recordings is said in words', lines.some(l => /No recordings/.test(l)), lines.join(' | '));
  ok('and one task is not called tasks', /1 task written down/.test(lines[0]), lines[0]);
}

// The calendar is reported only when there is one. A line reading "A calendar,
// 0 bytes" on a device that never imported one is noise.
{
  const withFeed = deviceLines(summarise({ stored: [], memory: [], calendarBytes: 220 * 1024 }));
  ok('a calendar is reported when there is one',
     withFeed.some(l => /A calendar, 220 KB/.test(l)), withFeed.join(' | '));
  const without = deviceLines(summarise({ stored: [], memory: [] }));
  ok('and not mentioned when there is not',
     !without.some(l => /calendar/i.test(l)), without.join(' | '));
}

// ── Nothing handed to it can make it throw ──
ok('an empty call still answers', Array.isArray(deviceLines(summarise())));
ok('and so does no summary at all', deviceLines(null).length === 0);
ok('a list that is not a list is empty', notesIn(null).count === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
