import { Platform } from 'react-native';
import { noteFileName, splitDataUri } from './audio';

// Giving the player something it can actually open.
//
// A voice note is base64 inside the vault — that is what lets it survive a
// reinstall and travel between devices, and it is not going to change. But it
// is also a string of up to seven hundred kilobytes, and on a phone handing one
// to the audio player means pushing it across the native bridge and through
// iOS's URL parser before any audio code sees it. Reported as: the play button
// does nothing at all, on every note, in both places it appears, and the
// triangle never even becomes a stop square.
//
// So on a phone the bytes are written to a real file once and the player is
// given a path. The web keeps the data URI, because a browser takes one on an
// audio element directly and has no filesystem worth writing to.
//
// Same name every time for the same recording, so a note played twice is
// written once and the cache does not fill with copies of one voice.

const made = new Map();

export function resetNoteFiles() {
  made.clear();
}

export async function playableUri(uri) {
  if (typeof uri !== 'string' || uri === '') return null;
  // Already a path, or a web page that can read the data URI itself.
  if (!uri.startsWith('data:') || Platform.OS === 'web') return uri;

  const parts = splitDataUri(uri);
  const name = noteFileName(uri);
  if (!parts || !name) return uri;

  if (made.has(name)) return made.get(name);

  try {
    // Imported here rather than at the top: the web bundle has no use for it,
    // and a module that throws on load takes the whole screen with it.
    const { File, Paths } = await import('expo-file-system');
    const file = new File(Paths.cache, name);
    if (!file.exists) {
      file.create({ intermediates: true, overwrite: true });
      file.write(parts.base64, { encoding: 'base64' });
    }
    const path = file.uri;
    made.set(name, path);
    return path;
  } catch {
    // The data URI is what the player was given before this existed. It may not
    // work, but it is no worse than refusing to try.
    return uri;
  }
}
