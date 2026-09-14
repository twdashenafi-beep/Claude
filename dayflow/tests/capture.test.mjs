// Keeping the audio of what you dictated.
//
// Two things are being checked, and the second matters more than the feature.
//
// One: that a recording is kept when the device allows one, so a mishearing is
// recoverable and a thought can be captured without naming it first.
//
// Two, and this is the important half: that every way it can fail ends with the
// microphone handed back and null returned. A capture that throws must not break
// dictation, which is the part that already worked — and a microphone left open
// is the worst outcome available, because the browser goes on showing the
// recording light for a page that has stopped listening.
//
// Run with `npm test`.
import { captureSupported, startCapture, finishCapture, abandonCapture } from '../src/services/capture.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// ── a microphone that can be watched ──
function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track] };
}
function install({
  getUserMedia,
  recorderThrows = false,
  startThrows = false,
  stopThrows = false,
  neverStops = false,
  chunks = [],
  encoded = 'data:audio/webm;base64,QUJD',
} = {}) {
  const made = [];
  const stream = fakeStream();
  globalThis.navigator = {
    mediaDevices: {
      getUserMedia: getUserMedia || (async () => stream),
    },
  };
  globalThis.MediaRecorder = function MediaRecorderStub() {
    if (recorderThrows) throw new Error('unsupported');
    const self = {
      state: 'inactive',
      mimeType: 'audio/webm',
      ondataavailable: null,
      onstop: null,
      start() {
        if (startThrows) throw new Error('cannot start');
        self.state = 'recording';
      },
      stop() {
        if (stopThrows) throw new Error('cannot stop');
        self.state = 'inactive';
        for (const data of chunks) if (self.ondataavailable) self.ondataavailable({ data });
        if (!neverStops && self.onstop) self.onstop();
      },
    };
    made.push(self);
    return self;
  };
  globalThis.Blob = function BlobStub(parts, opts) { return { parts, type: opts && opts.type, size: 10 }; };
  let revoked = 0;
  globalThis.URL = { createObjectURL: () => 'blob:stub/1', revokeObjectURL: () => { revoked += 1; } };
  globalThis.fetch = async () => ({ blob: async () => ({ size: 10 }) });
  globalThis.FileReader = class {
    readAsDataURL() { setTimeout(() => { this.result = encoded; this.onloadend(); }, 0); }
  };
  return { stream, made, revoked: () => revoked };
}
const clear = () => {
  delete globalThis.navigator; delete globalThis.MediaRecorder;
  delete globalThis.Blob; delete globalThis.URL;
  delete globalThis.fetch; delete globalThis.FileReader;
};

// ── Devices that simply cannot ──
clear();
ok('no navigator at all is unsupported', captureSupported() === false);
ok('and starting returns nothing rather than throwing', (await startCapture()) === null);

globalThis.navigator = { mediaDevices: { getUserMedia: async () => fakeStream() } };
ok('no MediaRecorder is unsupported', captureSupported() === false);
ok('and still returns nothing', (await startCapture()) === null);

globalThis.navigator = {};
globalThis.MediaRecorder = function () {};
ok('no mediaDevices is unsupported', captureSupported() === false);

install();
ok('a device with both is supported', captureSupported() === true);

// ── Every way it can refuse hands the microphone back ──
{
  const kit = install({ getUserMedia: async () => { throw new Error('denied'); } });
  ok('a refused microphone returns nothing', (await startCapture()) === null);
  ok('and nothing was left holding it', kit.stream.track.stopped === false, 'never opened');
}
{
  const kit = install({ recorderThrows: true });
  ok('a recorder that will not construct returns nothing', (await startCapture()) === null);
  ok('and the microphone is handed back', kit.stream.track.stopped === true);
}
{
  const kit = install({ startThrows: true });
  ok('a recorder that will not start returns nothing', (await startCapture()) === null);
  ok('and the microphone is handed back then too', kit.stream.track.stopped === true);
}

// ── A recording that works ──
{
  const kit = install({ chunks: [{ size: 4 }] });
  const handle = await startCapture();
  ok('a good device gives a handle', !!handle);
  ok('and is recording', kit.made[0].state === 'recording');

  const uri = await finishCapture(handle);
  ok('finishing gives back the recording itself',
     uri === 'data:audio/webm;base64,QUJD', String(uri));
  ok('the recorder was stopped', kit.made[0].state === 'inactive');
  ok('and the microphone released', kit.stream.track.stopped === true);
  ok('and the temporary url cleaned up', kit.revoked() === 1, String(kit.revoked()));
}

// ── Nothing recorded is not a recording ──
{
  const kit = install({ chunks: [] });
  const handle = await startCapture();
  ok('silence gives back nothing', (await finishCapture(handle)) === null);
  ok('and still releases the microphone', kit.stream.track.stopped === true);
}
ok('finishing nothing is safe', (await finishCapture(null)) === null);
ok('and finishing undefined', (await finishCapture(undefined)) === null);

// ── A recorder that misbehaves on the way out ──
{
  const kit = install({ chunks: [{ size: 4 }], stopThrows: true });
  const handle = await startCapture();
  const uri = await finishCapture(handle);
  ok('a stop that throws does not hang the task', uri === null, String(uri));
  ok('and the microphone still goes back', kit.stream.track.stopped === true);
}

// A recorder that never fires onstop must not hold the new task for ever. The
// wait is capped; here it is only proved that it resolves at all.
{
  const kit = install({ chunks: [{ size: 4 }], neverStops: true });
  const handle = await startCapture();
  const settled = await Promise.race([
    finishCapture(handle).then(() => 'settled'),
    new Promise(r => setTimeout(() => r('hung'), 3000)),
  ]);
  ok('a recorder that never reports stopping still settles', settled === 'settled', settled);
  ok('and the microphone is not left open', kit.stream.track.stopped === true);
}

// ── Walking away mid-sentence ──
{
  const kit = install({ chunks: [{ size: 4 }] });
  const handle = await startCapture();
  abandonCapture(handle);
  ok('abandoning stops the recorder', kit.made[0].state === 'inactive');
  ok('and hands the microphone back', kit.stream.track.stopped === true);
}
ok('abandoning nothing is safe', (abandonCapture(null), true));
ok('and abandoning undefined', (abandonCapture(undefined), true));

// ── Too large to keep is the same as none ──
{
  install({ chunks: [{ size: 4 }] });
  globalThis.fetch = async () => ({ blob: async () => ({ size: 50 * 1024 * 1024 }) });
  const handle = await startCapture();
  ok('a recording too big to keep gives back nothing',
     (await finishCapture(handle)) === null);
}

clear();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
