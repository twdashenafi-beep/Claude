// Keeping the audio of what you dictated.
//
// The quick-add microphone already listens and turns what you said into a task.
// It then threw the recording away, which is a shame twice over.
//
// The first is capture. To attach a voice note you had to create and name a task
// first — and naming is exactly the work you are trying to defer when something
// occurs to you on the way to somewhere else. Keeping the audio makes the
// microphone a way of getting a thought out of your head without deciding what
// it is yet: it lands in To Do like anything else, and you sort it later.
//
// The second is that recognition is not very good. A mishearing used to leave a
// garbled title and no way back to what you actually said. With the audio kept,
// the garble is recoverable — you listen, and you fix it.
//
// Everything here is written to fail quietly. Recognition and recording both
// want the microphone, and whether a given browser will hand it to both is not
// something this can know in advance. If any of it fails, the answer is null and
// the app behaves exactly as it did before: you still get your task, just
// without the recording. Nothing here is ever allowed to break dictation, which
// is the part that already worked.

// Spelled with its extension, unlike most imports here: the unit tests load
// this module in node, which does not guess at one. Metro is happy either way.
import { toDurableUri } from './audio.js';

// A backstop, not a limit anyone should meet. Dictation ends on a pause or on
// letting go, so this only catches a microphone left running by a bug.
const MAX_MS = 90 * 1000;

export function captureSupported() {
  return typeof navigator !== 'undefined'
    && !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function')
    && typeof globalThis.MediaRecorder === 'function';
}

function releaseMic(stream) {
  try {
    const tracks = stream && typeof stream.getTracks === 'function' ? stream.getTracks() : [];
    for (const track of tracks) {
      try { track.stop(); } catch { /* already stopped */ }
    }
  } catch { /* nothing holdable */ }
}

// Begins recording, or returns null if this device will not.
export async function startCapture() {
  if (!captureSupported()) return null;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    // Refused, unavailable, or already taken by the recogniser. Not an error
    // worth showing: dictation is unaffected and that is what was asked for.
    return null;
  }

  let recorder;
  try {
    recorder = new globalThis.MediaRecorder(stream);
  } catch {
    releaseMic(stream);
    return null;
  }

  const chunks = [];
  recorder.ondataavailable = e => { if (e && e.data && e.data.size) chunks.push(e.data); };

  try {
    recorder.start();
  } catch {
    releaseMic(stream);
    return null;
  }

  const handle = { stream, recorder, chunks, timer: null };
  handle.timer = setTimeout(() => {
    try { recorder.stop(); } catch { /* already stopped */ }
  }, MAX_MS);
  return handle;
}

// Ends the recording and returns something that will still play tomorrow, or
// null if there is nothing worth keeping.
export async function finishCapture(handle) {
  if (!handle) return null;
  clearTimeout(handle.timer);
  const { recorder, stream, chunks } = handle;

  try {
    if (recorder && recorder.state !== 'inactive') {
      // The last chunk arrives with the stop event, so waiting for it is the
      // difference between the whole sentence and all but its end. The timeout
      // is there because a recorder that never fires it must not hang the task
      // that is waiting to be created.
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        recorder.onstop = finish;
        setTimeout(finish, 1500);
        try { recorder.stop(); } catch { finish(); }
      });
    }
  } catch { /* take whatever arrived */ }

  releaseMic(stream);
  if (!chunks.length) return null;

  let url;
  try {
    const blob = new globalThis.Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
    url = globalThis.URL.createObjectURL(blob);
  } catch {
    return null;
  }

  try {
    // The same conversion a voice note gets, so it survives a reload and syncs
    // with the task — and is refused on the same terms if it is too large.
    return await toDurableUri(url);
  } catch {
    return null;
  } finally {
    try { globalThis.URL.revokeObjectURL(url); } catch { /* already gone */ }
  }
}

// Stops recording and keeps nothing. For leaving the page mid-sentence, where
// the microphone still has to be handed back.
export function abandonCapture(handle) {
  if (!handle) return;
  clearTimeout(handle.timer);
  try {
    if (handle.recorder) {
      handle.recorder.ondataavailable = null;
      handle.recorder.onstop = null;
      if (handle.recorder.state !== 'inactive') handle.recorder.stop();
    }
  } catch { /* already stopped */ }
  releaseMic(handle.stream);
}
