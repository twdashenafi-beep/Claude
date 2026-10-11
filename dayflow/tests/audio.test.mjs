// Making a recording outlast the page that made it.
//
// expo-audio hands back a URI that only means something where it was made. On
// the web that is a blob: URL belonging to one tab, so a voice note survived
// until the first refresh and then became a play button with nothing behind it.
//
// The conversion has to fail safe in two different directions, which is most of
// what is checked here. If it cannot convert — no fetch, no FileReader, a reader
// that errors — it must hand back what it was given, because on a phone that is
// a real file and working no worse than before. If the recording is too large it
// must refuse outright, because the vault it would go into is the same few
// megabytes that every typed task lives in.
//
// Run with `npm test`.
import { toDurableUri, MAX_NOTE_BYTES, MIN_NOTE_MS, tooShort, slidUp, LOCK_DY, splitDataUri, extensionFor, noteFileName, mimeForPath, noteTrouble } from '../src/services/audio.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const realFetch = globalThis.fetch;
const realReader = globalThis.FileReader;
const restore = () => {
  globalThis.fetch = realFetch;
  globalThis.FileReader = realReader;
};

// A FileReader that resolves to whatever it is told to.
function readerYielding(result, { error = false } = {}) {
  return class {
    readAsDataURL() {
      setTimeout(() => {
        if (error) this.onerror(new Error('nope'));
        else { this.result = result; this.onloadend(); }
      }, 0);
    }
  };
}
const fetchYielding = blob => async () => ({ blob: async () => blob });

// ── Nothing to do ──
ok('an empty uri comes back as it went', await toDurableUri('') === '');
ok('null comes back', await toDurableUri(null) === null);
ok('a number is not mangled', await toDurableUri(7) === 7);
ok('a data uri is already durable',
   await toDurableUri('data:audio/webm;base64,AAA') === 'data:audio/webm;base64,AAA');

// ── Nowhere to convert it ──
//
// A phone has neither of these, and there the original is a real file on disk.
// Handing it back is what the app did before any of this existed.
globalThis.fetch = undefined;
globalThis.FileReader = undefined;
ok('with no fetch, the original is kept', await toDurableUri('file:///tmp/a.m4a') === 'file:///tmp/a.m4a');
globalThis.fetch = fetchYielding({ size: 10 });
ok('with no FileReader either', await toDurableUri('file:///tmp/a.m4a') === 'file:///tmp/a.m4a');
restore();

// ── It converts ──
globalThis.fetch = fetchYielding({ size: 1000 });
globalThis.FileReader = readerYielding('data:audio/webm;base64,QUJD');
ok('a blob becomes the recording itself',
   await toDurableUri('blob:http://x/1') === 'data:audio/webm;base64,QUJD');

// ── It fails safe ──
globalThis.fetch = async () => { throw new Error('gone'); };
ok('a fetch that throws keeps the original',
   await toDurableUri('blob:http://x/1') === 'blob:http://x/1');

globalThis.fetch = fetchYielding(null);
ok('nothing to read keeps the original',
   await toDurableUri('blob:http://x/1') === 'blob:http://x/1');

globalThis.fetch = fetchYielding({ size: 10 });
globalThis.FileReader = readerYielding(null, { error: true });
ok('a reader that errors keeps the original',
   await toDurableUri('blob:http://x/1') === 'blob:http://x/1');

globalThis.FileReader = readerYielding('not a data uri at all');
ok('a reader that returns something else keeps the original',
   await toDurableUri('blob:http://x/1') === 'blob:http://x/1');

globalThis.FileReader = readerYielding(undefined);
ok('and so does one that returns nothing',
   await toDurableUri('blob:http://x/1') === 'blob:http://x/1');

// ── It refuses what will not fit ──
//
// Null rather than the original, and deliberately so: keeping the blob URL here
// would put a play button on the row with nothing behind it, which is the exact
// thing this module exists to stop.
globalThis.fetch = fetchYielding({ size: MAX_NOTE_BYTES });
globalThis.FileReader = readerYielding('data:audio/webm;base64,QUJD');
ok('a recording too big to encode is refused',
   await toDurableUri('blob:http://x/1') === null);

// The size check before encoding is a guess — base64 adds a third — so the
// encoded string is checked too.
globalThis.fetch = fetchYielding({ size: 1 });
globalThis.FileReader = readerYielding('data:audio/webm;base64,' + 'A'.repeat(MAX_NOTE_BYTES));
ok('and so is one that only turns out too big after encoding',
   await toDurableUri('blob:http://x/1') === null);

// Just under, on both paths.
globalThis.fetch = fetchYielding({ size: Math.floor((MAX_NOTE_BYTES * 3) / 4) - 10 });
globalThis.FileReader = readerYielding('data:audio/webm;base64,QUJD');
ok('but one that just fits is kept',
   await toDurableUri('blob:http://x/1') === 'data:audio/webm;base64,QUJD');

// A blob with no size at all — some implementations do not report one — is not
// refused on a guess.
globalThis.fetch = fetchYielding({});
ok('a blob that will not say how big it is is still tried',
   await toDurableUri('blob:http://x/1') === 'data:audio/webm;base64,QUJD');

restore();

// ── The cap is a real number ──
ok('the cap is about a minute of speech',
   MAX_NOTE_BYTES > 300 * 1024 && MAX_NOTE_BYTES < 2 * 1024 * 1024, String(MAX_NOTE_BYTES));

// ── Too short to have been meant ──
//
// The microphone starts after a fifth of a second of holding, so the accident
// this guards against is not the brush — it is the hold that lasts just long
// enough to record a quarter-second of room tone, which then sits in the list
// looking exactly like a real note.
ok('a slip is not a note', tooShort(250));
ok('nor is one that only just started', tooShort(MIN_NOTE_MS - 1));
ok('but the threshold itself counts', !tooShort(MIN_NOTE_MS));
ok('and anything said into is kept', !tooShort(1500));
ok('as is a long one', !tooShort(60000));

// The other direction matters more than it looks. If the length could not be
// measured, the answer has to be no: discarding somebody's recording on the
// strength of a number we do not have is the one outcome worth avoiding.
ok('an unknown length is never discarded', !tooShort(null));
ok('nor an undefined one', !tooShort(undefined));
ok('nor a NaN', !tooShort(NaN));
ok('nor an infinite one', !tooShort(Infinity));
ok('nor a nonsense one', !tooShort('700'));
ok('nor a negative one, which is a clock that moved', !tooShort(-50));

// It has to be shorter than the shortest useful note and longer than a slip.
ok('the floor is under a second', MIN_NOTE_MS > 300 && MIN_NOTE_MS < 1200, String(MIN_NOTE_MS));

// ── Sliding up to keep recording, and lifting a thumb off ───────────────────
//
// They look the same to a single reading of the distance, and the second is far
// more common. A thumb rolls upward as it leaves the screen; forty-four pixels
// of roll is nothing on a phone, and a press somebody had finished with became
// a locked recording that ran until the minute was up. Reported from a real
// phone, and this is half the fix — the other half is that the caller holds the
// slide for a moment before the lock takes.
ok('a deliberate slide up locks it', slidUp(0, -60));
ok('and so does one with a little sideways in it', slidUp(10, -60));
ok('but not one that is more sideways than up', !slidUp(50, -60));
ok('nor a diagonal lift-off', !slidUp(-48, -48));
ok('and a slide only counts when it is mostly upward', slidUp(-20, -60));
ok('a short reach does not', !slidUp(0, -20));
ok('nor does the threshold itself', !slidUp(0, -LOCK_DY));
ok('one pixel past it does', slidUp(0, -LOCK_DY - 1));
ok('downwards never does, however far', !slidUp(0, 200));
ok('sideways never does either', !slidUp(200, 0));
ok('and nonsense never does',
   !slidUp('up', -60) && !slidUp(0, NaN) && !slidUp(undefined, undefined));

// ── Taking a stored note apart so it can be played ──────────────────────────
//
// A note is base64 in the vault, which is what makes it survive a reinstall and
// travel between devices. It is also up to seven hundred kilobytes of string,
// and handing that to the phone's player means pushing it across the native
// bridge and through iOS's URL parser before any audio code sees it. That is
// where playback was lost: the button never even became a stop square.
{
  const m4a = 'data:audio/x-m4a;base64,AAAAIGZ0eXBNNEEg';
  const webm = 'data:audio/webm;codecs=opus;base64,GkXfo59C';

  const got = splitDataUri(m4a);
  ok('a stored note comes apart into its type and its bytes',
     got && got.mime === 'audio/x-m4a' && got.base64 === 'AAAAIGZ0eXBNNEEg',
     JSON.stringify(got));

  // The browser writes "audio/webm;codecs=opus". The codec is not part of the
  // type, and leaving it on gives a file extension of nothing.
  ok('codec parameters are not part of the type',
     splitDataUri(webm).mime === 'audio/webm', JSON.stringify(splitDataUri(webm)));
  ok('and the bytes still come through whole',
     splitDataUri(webm).base64 === 'GkXfo59C', JSON.stringify(splitDataUri(webm)));

  ok('a file path is not a data uri', splitDataUri('file:///tmp/a.m4a') === null);
  ok('nor is nothing', splitDataUri(null) === null && splitDataUri('') === null);
  ok('a data uri that is not base64 is refused',
     splitDataUri('data:audio/wav,RIFF') === null);
  ok('and one with no bytes at all', splitDataUri('data:audio/m4a;base64,') === null);

  // ── The extension, which is how both players decide what to decode ──
  ok('m4a and its aliases all land on m4a',
     ['audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/aac']
       .every(t => extensionFor(t) === 'm4a'));
  ok('the browser format keeps its own', extensionFor('audio/webm') === 'webm');
  ok('and wav, mp3 and caf keep theirs',
     extensionFor('audio/wav') === 'wav' && extensionFor('audio/mpeg') === 'mp3'
     && extensionFor('audio/x-caf') === 'caf');
  // An unlabelled recording is still a recording, and this function names only
  // voice notes. '.dat' is the one extension certain not to open, so there is
  // nothing it can be the right answer for — and it is what every note whose
  // type was lost on the way to storage used to be written as.
  ok('an unknown audio type is treated as the format this app records',
     extensionFor('audio/something-new') === 'm4a');
  ok('and so is a type that is not audio at all, because a note is still a note',
     extensionFor('application/octet-stream') === 'm4a' && extensionFor('application/pdf') === 'm4a');
  ok('and so is nothing at all', extensionFor('') === 'm4a' && extensionFor(null) === 'm4a');

  // ── The name, which has to be the same every time ──
  ok('the same recording always gets the same name',
     noteFileName(m4a) === noteFileName(m4a), noteFileName(m4a));
  ok('and carries the right extension', noteFileName(m4a).endsWith('.m4a'), noteFileName(m4a));
  ok('a different recording gets a different name',
     noteFileName(m4a) !== noteFileName(webm),
     `${noteFileName(m4a)} vs ${noteFileName(webm)}`);
  // Every recording of one format begins with the same header bytes, so a name
  // taken from the start of the string would collide for all of them.
  const twin = `${m4a}AAAA`;
  ok('two recordings that start identically still differ',
     noteFileName(m4a) !== noteFileName(twin),
     `${noteFileName(m4a)} vs ${noteFileName(twin)}`);
  ok('and anything that is not a stored note has no name',
     noteFileName('file:///tmp/a.m4a') === null && noteFileName('') === null);
}

// ── The type, read off the name of the file the recorder wrote ─────────────
//
// This is the piece that was being thrown away, and throwing it away is why
// notes played on the web and not on a phone: a browser's blob carries
// MediaRecorder's own type, and a blob read from a file:// URL need not carry
// one at all. The recording was then stored as application/octet-stream — a
// note of unknown format, written to disk as note-xxxx.dat.
{
  ok('a recording written by the phone is recognised',
     mimeForPath('file:///var/mobile/Containers/Data/recording-AB12.m4a') === 'audio/m4a',
     mimeForPath('file:///var/mobile/Containers/Data/recording-AB12.m4a'));
  ok('whatever case the extension is in',
     mimeForPath('file:///tmp/a.M4A') === 'audio/m4a');
  ok('and the other formats a recorder can produce',
     mimeForPath('/tmp/a.wav') === 'audio/wav' && mimeForPath('/tmp/a.caf') === 'audio/x-caf'
     && mimeForPath('/tmp/a.webm') === 'audio/webm' && mimeForPath('/tmp/a.mp3') === 'audio/mpeg');
  ok('a query string is not part of the name',
     mimeForPath('https://x/note.m4a?token=abc') === 'audio/m4a');
  ok('a blob URL has no name to read', mimeForPath('blob:http://localhost/9f2c') === '');
  ok('nor has a path without an extension', mimeForPath('file:///tmp/recording') === '');
  // A dot in a directory and none in the file name, which is the case that
  // reads an extension off the wrong part of the path. Left as one line rather
  // than two: a version that never strips the directory still answers '' here,
  // because the lookup is exact and 'm4a/recording' is not a type — so there is
  // no implementation this can tell apart, and an assertion that cannot fail is
  // decoration. The hidden-file case below is the one that bites.
  ok('a hidden file has no extension', mimeForPath('/tmp/.m4a') === '');
  ok('junk has no type', mimeForPath('') === '' && mimeForPath(null) === ''
     && mimeForPath(undefined) === '');

  // ── And the type survives the trip through storage ──
  //
  // The whole point: what comes back out must say what it is, so that the file
  // written for the player carries an extension the player recognises.
  const keep = { fetch: globalThis.fetch, FileReader: globalThis.FileReader };
  globalThis.fetch = async () => ({ blob: async () => ({ size: 9 }) });

  // A platform that gave the blob no type at all, which is the iOS case.
  globalThis.FileReader = readerYielding('data:;base64,QUJD');
  const unlabelled = await toDurableUri('file:///tmp/recording-AB12.m4a');
  ok('a recording that came back with no type is labelled from its file',
     unlabelled === 'data:audio/m4a;base64,QUJD', unlabelled);
  ok('and is therefore written for the player as m4a, not dat',
     noteFileName(unlabelled).endsWith('.m4a'), noteFileName(unlabelled));

  globalThis.FileReader = readerYielding('data:application/octet-stream;base64,QUJD');
  const octet = await toDurableUri('file:///tmp/recording-AB12.m4a');
  ok('and so is one that came back as octet-stream',
     octet === 'data:audio/m4a;base64,QUJD', octet);

  // A browser's own label is better than an extension and must not be
  // overwritten: webm is what it is, and calling it m4a would write a file the
  // player then refuses.
  //
  // Read from a path whose extension disagrees, which is the only way this
  // asserts anything. Against a blob: URL there is no extension to prefer, so
  // the guard could be deleted and the test would still pass — it did, and the
  // falsification that should have caught it went straight through.
  globalThis.FileReader = readerYielding('data:audio/webm;base64,QUJD');
  const browser = await toDurableUri('file:///tmp/recording-AB12.m4a');
  ok('a type the platform did give is kept, even where the name disagrees',
     browser === 'data:audio/webm;base64,QUJD', browser);

  // Nothing to read it from, so nothing is invented.
  globalThis.FileReader = readerYielding('data:;base64,QUJD');
  const nameless = await toDurableUri('blob:http://localhost/9f2c');
  ok('a recording with neither type nor name is left as it arrived',
     nameless === 'data:;base64,QUJD', nameless);

  globalThis.fetch = keep.fetch;
  globalThis.FileReader = keep.FileReader;
}

// ── Saying why a note is not playing ───────────────────────────────────────
//
// Silence was the old answer, and four wrong guesses at this bug were paid for
// a build at a time because the only report available was "it still does not
// work".
{
  const loaded = { isLoaded: true };
  const not = { isLoaded: false };
  const note = mime => `data:${mime};base64,${'A'.repeat(4000)}`;

  ok('a note that loaded says nothing', noteTrouble(note('audio/m4a'), loaded) === '');
  ok('nor does one nothing is known about yet', noteTrouble(note('audio/m4a'), null) === '');
  ok('nor does the web, where this has always worked',
     noteTrouble(note('audio/webm'), not, false) === '');

  const browser = noteTrouble(note('audio/webm'), not);
  ok('a browser recording on a phone is named rather than called a failure',
     browser.includes('browser') && browser.includes('web version'), browser);
  ok('and ogg is the same case', noteTrouble(note('audio/ogg'), not) === browser);

  const unknown = noteTrouble(note('application/octet-stream'), not);
  ok('anything else reports what the note actually is',
     unknown.includes('application/octet-stream'), unknown);
  ok('and how big it is, so a note of nothing is distinguishable from a real one',
     /\b3 KB\b/.test(unknown), unknown);
  ok('a note of almost nothing still reads as a size',
     /\b1 KB\b/.test(noteTrouble('data:audio/m4a;base64,QUJD', not)),
     noteTrouble('data:audio/m4a;base64,QUJD', not));
  ok('something that is not a stored note still says it could not be opened',
     noteTrouble('file:///tmp/a.m4a', not) === 'This note could not be opened');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
