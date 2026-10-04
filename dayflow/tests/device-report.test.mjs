// What this device is holding, and whether it agrees with what is on screen.
//
// The report exists for one question: did the recording ever reach the drawer?
// So the case that matters most here is the disagreement — a note in memory
// that is not in storage — because that is the shape of the bug it was built
// to find, and a report that stayed quiet about it would be worse than none.
//
// Run with `npm test`.

import {
  bytesOf, sizeWords, notesIn, summarise, deviceLines, dictationLine, calendarLine,
  buildLine, syncLine, listeningLine, speechTrouble,
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

// ── Where the microphone comes from ──
//
// The button is absent in four different situations and they are not the same
// problem. Two builds went by before anybody could tell which one was in front
// of them, so each has to say something different.
{
  const said = ['browser', 'device', 'no-browser-engine', 'not-in-this-build', 'no-engine-in-module']
    .map(dictationLine);
  ok('every case says something', said.every(line => line.length > 0), JSON.stringify(said));
  ok('and no two of them say the same thing', new Set(said).size === said.length, JSON.stringify(said));

  ok('a build without the module says so',
     /not in this build/.test(dictationLine('not-in-this-build')), dictationLine('not-in-this-build'));
  ok('which is not what a phone with dictation says',
     /this device/.test(dictationLine('device')), dictationLine('device'));
  ok('and a browser is named as the browser',
     /this browser/.test(dictationLine('browser')), dictationLine('browser'));
  ok('anything unrecognised says nothing rather than guessing',
     dictationLine('something-else') === '' && dictationLine() === '');
}

// ── What happened when the phone's calendar was read ──
//
// Four causes, one empty line under the date: refused, no calendars offered,
// the module's functions moved, or genuinely nothing in the diary. Only one of
// those is a bug and only one is fixed in iPhone Settings, so the report has to
// distinguish them rather than say "no calendar".
ok('nothing read says nothing', calendarLine('') === '' && calendarLine() === '');
ok('and whitespace is nothing too', calendarLine('   ') === '');
{
  const refused = calendarLine('not allowed — denied. iPhone Settings › DayFlow › Calendars › Full Access');
  ok('a refusal names the setting that fixes it', /Settings/.test(refused), refused);

  const broken = calendarLine('the calendar module is not the shape this app expects');
  ok('a broken module says so instead', /not the shape/.test(broken), broken);
  ok('and the two do not read alike', refused !== broken);

  const fine = calendarLine('read 3 calendars, 0 events in the next three weeks');
  ok('a successful read is reported too, which is the quiet failure',
     /0 events/.test(fine), fine);
  ok('all three are told apart', new Set([refused, broken, fine]).size === 3);
}

// ── Which copy of DayFlow this is ───────────────────────────────────────────
//
// Written after an afternoon spent not knowing. A change went out, the web
// deploy was green, and the phone kept showing the old screen — and from
// inside the app there was no way to tell whether the phone was holding a
// cached web page or running a build that predated the work. Those are fixed
// in two different places, so the line has to say which before it says any
// number at all.
{
  ok('the web app says it is the web app',
     buildLine({ platform: 'web', stamp: '20261004-1243' }) === 'Web app · build 20261004-1243',
     buildLine({ platform: 'web', stamp: '20261004-1243' }));

  // "Build dev" is what the export script leaves when nothing stamped it, and
  // it reads like a build somebody could go and look up. Nobody can.
  ok('and an unstamped one says so rather than naming a build nobody can find',
     buildLine({ platform: 'web', stamp: 'dev' }) === 'Web app · built from source',
     buildLine({ platform: 'web', stamp: 'dev' }));
  ok('as does one with no stamp at all',
     buildLine({ platform: 'web' }) === 'Web app · built from source');

  // The number TestFlight lists, so the two can be held side by side.
  ok('the installed app gives the version and the build',
     buildLine({ platform: 'ios', version: '1.0.0', build: '18' })
       === 'Installed app · 1.0.0 (18)',
     buildLine({ platform: 'ios', version: '1.0.0', build: '18' }));
  ok('and the same on the other phone',
     buildLine({ platform: 'android', version: '1.0.0', build: '18' })
       === 'Installed app · 1.0.0 (18)');
  ok('a version with no build number still says the version',
     buildLine({ platform: 'ios', version: '1.0.0' }) === 'Installed app · 1.0.0',
     buildLine({ platform: 'ios', version: '1.0.0' }));

  // The module is reached through a try/catch, so it can come back empty. A
  // line that quietly dropped to nothing would leave exactly the gap this
  // was written to close.
  ok('and a module that told it nothing says that, rather than going quiet',
     buildLine({ platform: 'ios' }) === 'Installed app · build unknown',
     buildLine({ platform: 'ios' }));

  ok('nothing at all is still a line', typeof buildLine() === 'string' && buildLine().length > 0,
     String(buildLine()));
  // The whole point: the two platforms are never confusable.
  ok('the web app and the installed app can never read the same',
     buildLine({ platform: 'web', stamp: 'x' }) !== buildLine({ platform: 'ios', version: 'x' }));
  ok('and each says which it is before it says any number',
     /^Web app/.test(buildLine({ platform: 'web', stamp: 'x' }))
       && /^Installed app/.test(buildLine({ platform: 'ios', version: 'x' })));
}

// ── Why the last sync failed ────────────────────────────────────────────────
//
// The page says "sync failed — will retry", which is right for a page: it is
// context, not an incident. But those four words cover a row-level security
// rule, an expired session, a table that is not there and a train tunnel, and
// the reason went to console.warn — which on a phone is nowhere at all.
{
  const said = syncLine('error', '42501 new row violates row-level security policy');
  ok('a failure gives the reason the server gave',
     said === 'The last sync failed: 42501 new row violates row-level security policy', said);

  // A failure with nothing attached still says a failure happened. Going quiet
  // would put it back where it was.
  ok('and a failure with no reason says that, rather than nothing',
     syncLine('error', '') === 'The last sync failed, and said no reason why',
     syncLine('error', ''));
  ok('as does one with only whitespace',
     syncLine('error', '   ') === 'The last sync failed, and said no reason why');

  // Every other state is silent. A report that says "the last sync failed" on
  // a device syncing happily is a report nobody trusts twice.
  for (const state of ['ok', 'off', 'idle', 'syncing']) {
    ok(`a device that is ${state} says nothing about failures`,
       syncLine(state, 'stale reason from before') === '', syncLine(state, 'x'));
  }
}

// ── An engine, and permission to use it ─────────────────────────────────────
//
// Two questions that were being answered as one. "Dictation comes from this
// device" says there is an engine in this build; it says nothing about
// whether iOS has been asked, or asked and refused. On a phone with a
// microphone button that does nothing, the report said the first and was
// read as the second — confidently answering the wrong question, which is
// worse than saying nothing.
{
  ok('a device that may listen says so',
     /allowed to listen/.test(listeningLine('granted')), listeningLine('granted'));

  // The two refusals are not the same and are not fixed in the same place:
  // one is answered by tapping the button, the other only in Settings.
  const refused = listeningLine('refused');
  ok('a device that was refused says where that is undone',
     /Settings/.test(refused), refused);
  ok('and one that was never asked says that instead',
     /not been asked/.test(listeningLine('unasked')), listeningLine('unasked'));
  ok('the two refusals are told apart', refused !== listeningLine('unasked'));

  // Nothing to ask: the engine's absence is already reported by the line
  // beside this one, and saying it twice in two voices helps nobody.
  ok('a device with nothing to ask says nothing', listeningLine('') === '');
  ok('and neither does an answer that never came', listeningLine(undefined) === '');
  ok('nor one this does not recognise', listeningLine('something else') === '');
}

// ── When dictation stops badly ──────────────────────────────────────────────
//
// Five codes had sentences and every other code had nothing, so a microphone
// that failed for any other reason stopped without a word and the button
// looked broken. That is the fault that has cost this project more time than
// any other: something that does not work and does not say so.
{
  ok('a blocked microphone says where to unblock it',
     /Settings/.test(speechTrouble('not-allowed')), speechTrouble('not-allowed'));
  ok('and a blocked recogniser is told apart from it',
     speechTrouble('service-not-allowed') !== speechTrouble('not-allowed'),
     speechTrouble('service-not-allowed'));
  ok('no microphone at all says so', /No microphone/.test(speechTrouble('audio-capture')));
  ok('and a dead connection says so', /connection/.test(speechTrouble('network')));

  // The whole point of the change: a code nobody anticipated.
  const odd = speechTrouble('kAFAssistantErrorDomain-1101');
  ok('a code this app has never heard of is still said out loud', odd !== '', odd);
  ok('and the code itself is quoted, so it can be repeated to somebody',
     odd.includes('kAFAssistantErrorDomain-1101'), odd);

  // Two that must stay quiet. 'aborted' is the component going away and
  // 'no-speech' is a quiet room; neither is news, and a message for either
  // would mean the button nags every time it is let go.
  ok('being taken off the page says nothing', speechTrouble('aborted') === '');
  ok('and a quiet room says nothing', speechTrouble('no-speech') === '');
  ok('nor does no code at all', speechTrouble('') === '' && speechTrouble(null) === '');
  ok('nor whitespace pretending to be one', speechTrouble('   ') === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
