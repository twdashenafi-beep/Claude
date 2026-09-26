// Making a recording outlast the page that made it.
//
// expo-audio hands back a URI that is only meaningful where it was made. On the
// web that is a blob: URL, which lives in one tab's memory and dies with it — so
// a voice note recorded this morning played back perfectly until the first
// refresh, after which the row still offered a play button and the audio behind
// it was gone. The button kept a promise the app could no longer keep, which is
// worse than never having offered.
//
// A data: URI has no such dependency. It is the recording itself, so it survives
// a reload, and because every task is encrypted whole it also reaches your other
// devices by the path everything else already takes — no new column, no bucket,
// no second system to keep in step.
//
// What it costs is room. The vault lives in local storage, which is a few
// megabytes in total, so the recorder holds notes to a minute and anything that
// still comes out too large is refused rather than quietly filling the drawer
// that all your typed tasks also live in.

// Roughly a minute of speech once base64 has added its third. Past this the
// answer is a note, not a monologue.
export const MAX_NOTE_BYTES = 700 * 1024;

// The other end of the same scale.
//
// The microphone starts after a fifth of a second of holding, so a brush is
// already meant to do nothing — but a brush that lasts a little longer used to
// leave a moment of room tone attached to the task, indistinguishable from a
// real note until you played it. Below this, the hold was a slip.
//
// Measured from when the recorder actually opened, not from when the finger
// went down, and the gap between those two is most of why this number is low.
// Starting is not instant: permission, the audio session and preparing the
// recorder are all awaited, and they cost a few hundred milliseconds on a cold
// first press. A threshold set where a short note sounds like it ends — say
// three quarters of a second — therefore throws away nine-tenths of a second
// of holding, which is a real note by anybody's reckoning. Under four hundred
// milliseconds there is no room for a word.
export const MIN_NOTE_MS = 400;

// Whether a recording is too brief to have been meant.
//
// Only says yes when the length is actually known. If something could not be
// timed the answer is no: throwing away audio on a measurement we do not have
// is the one outcome worth avoiding here.
export function tooShort(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return false;
  return ms < MIN_NOTE_MS;
}

// A URI that will still mean something tomorrow, or null if the recording was
// too large to keep.
//
// Anything that cannot be converted comes back untouched rather than lost: on a
// phone the original is a real file on disk, which is what the app did before
// this existed and is no worse for having tried.
export async function toDurableUri(uri) {
  if (typeof uri !== 'string' || uri === '') return uri;
  if (uri.startsWith('data:')) return uri;

  const fetchImpl = globalThis.fetch;
  const Reader = globalThis.FileReader;
  if (typeof fetchImpl !== 'function' || typeof Reader !== 'function') return uri;

  let blob;
  try {
    const response = await fetchImpl(uri);
    blob = await response.blob();
  } catch {
    return uri;
  }
  if (!blob) return uri;

  // Checked before encoding rather than after: base64 of something enormous is
  // a large string to build only to throw away.
  if (typeof blob.size === 'number' && blob.size * (4 / 3) > MAX_NOTE_BYTES) return null;

  let encoded;
  try {
    encoded = await new Promise((resolve, reject) => {
      const reader = new Reader();
      reader.onerror = () => reject(new Error('could not read the recording'));
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return uri;
  }

  if (typeof encoded !== 'string' || !encoded.startsWith('data:')) return uri;
  // The size guess above is a guess; this is the thing that will actually be
  // stored.
  if (encoded.length > MAX_NOTE_BYTES) return null;
  return encoded;
}

// Whether a gesture is somebody sliding the button up to keep recording
// hands-free, or a thumb on its way off the screen.
//
// They look the same to a single reading of the distance, and the second one is
// far more common: a thumb rolls upward as it lifts, and forty-four pixels of
// roll is nothing on a phone. That is how a press somebody had finished with
// turned into a locked recording that ran until the minute was up.
//
// So the slide has to be up rather than merely upward — a lift-off is usually
// diagonal, because the thumb is also leaving the screen sideways — and the
// caller holds it there for a moment before the lock takes. Between them, the
// deliberate gesture is unchanged and the accident no longer qualifies.
export const LOCK_DY = 44;

export function slidUp(dx, dy) {
  if (typeof dx !== 'number' || typeof dy !== 'number') return false;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  // Past the threshold, not merely at it.
  if (dy >= -LOCK_DY) return false;
  // Mostly up: within about twenty-five degrees of vertical. Half the upward
  // distance rather than all of it, because "less sideways than up" still
  // admits a forty-degree drag, and a thumb leaving the screen goes sideways
  // as much as it goes up.
  return Math.abs(dx) * 2 <= Math.abs(dy);
}
