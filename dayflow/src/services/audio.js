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
