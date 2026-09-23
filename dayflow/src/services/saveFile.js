import { Platform, Share } from 'react-native';

// Getting a file out of the app and onto something you own.
//
// Which mechanism to use is not a matter of taste here; it is a matter of which
// one exists on the thing you are holding. DayFlow is used as a home-screen web
// app on an iPhone, and a standalone web app is the most restricted place this
// code runs:
//
//   The share sheet is tried first. On iOS it is the only route that reliably
//   ends in "Save to Files", and it works in a home-screen app where a plain
//   download historically did nothing at all — no file, no error, no sign that
//   anything had been asked for. A silent failure is the worst outcome for a
//   backup, because you find out when you need it.
//
//   A download link is the fallback, and the path every desktop browser takes:
//   sharing files is not offered on most of them, so canShare says no and this
//   runs instead.
//
// On a native build there is no file system module in this project — adding one
// before the first device build has ever succeeded is a risk worth not taking —
// so the text goes to the system share sheet, which can write it to Files. Past
// a certain size that stops being reasonable, and saying so is better than
// handing the operating system several megabytes in a string and watching it
// decide.

// A share sheet carries a message, not a file, on native. Beyond this it is the
// wrong tool and will be a spinner rather than a saved file.
export const SHARE_LIMIT = 512 * 1024;

// 'saved'      — written, or handed to something that writes it
// 'cancelled'  — the sheet was dismissed; nothing is wrong
// 'toolarge'   — no route on this platform can carry it
// 'unavailable'— nothing here can save a file at all
export async function saveTextFile(name, text, type = 'application/json') {
  if (typeof text !== 'string' || text === '') return 'unavailable';

  if (Platform.OS !== 'web') {
    if (text.length > SHARE_LIMIT) return 'toolarge';
    try {
      const result = await Share.share({ message: text, title: name });
      return result && result.action === Share.dismissedAction ? 'cancelled' : 'saved';
    } catch {
      return 'unavailable';
    }
  }

  const shared = await shareAsFile(name, text, type);
  if (shared) return shared;
  return downloadAsFile(name, text, type) ? 'saved' : 'unavailable';
}

// Returns a result if the share sheet handled it, or null to fall through.
async function shareAsFile(name, text, type) {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const FileCtor = globalThis.File;
  if (!nav || typeof nav.share !== 'function' || typeof FileCtor !== 'function') return null;

  let file;
  try {
    file = new FileCtor([text], name, { type });
  } catch {
    return null;
  }
  // Asked rather than assumed: a browser can have navigator.share and refuse
  // files, and calling share with files it will not take throws.
  if (typeof nav.canShare === 'function' && !nav.canShare({ files: [file] })) return null;

  try {
    await nav.share({ files: [file], title: name });
    return 'saved';
  } catch (err) {
    // Dismissing the sheet is not a failure, and must not be reported as one.
    const kind = err && err.name;
    if (kind === 'AbortError' || kind === 'NotAllowedError') return 'cancelled';
    // Anything else: fall through to the download, which may well work.
    return null;
  }
}

function downloadAsFile(name, text, type) {
  const doc = typeof document === 'undefined' ? null : document;
  const URLCtor = globalThis.URL;
  const BlobCtor = globalThis.Blob;
  if (!doc || !BlobCtor || !URLCtor || typeof URLCtor.createObjectURL !== 'function') return false;

  let url;
  try {
    url = URLCtor.createObjectURL(new BlobCtor([text], { type }));
    const link = doc.createElement('a');
    link.href = url;
    link.download = name;
    // Appended before it is clicked: a link that is not in the document does
    // nothing in Firefox.
    doc.body.appendChild(link);
    link.click();
    doc.body.removeChild(link);
    return true;
  } catch {
    return false;
  } finally {
    // Held long enough for the browser to have started reading it. Revoking
    // immediately cancels the download it was created for.
    if (url) setTimeout(() => URLCtor.revokeObjectURL(url), 30000);
  }
}
