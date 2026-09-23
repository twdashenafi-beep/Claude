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
import { toDurableUri, MAX_NOTE_BYTES, MIN_NOTE_MS, tooShort } from '../src/services/audio.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
