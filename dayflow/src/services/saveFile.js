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
// On an iPhone the backup is written to a file and the file is shared. It used to
// be sent as the share sheet's *message* — a string — because this project had
// no filesystem module, and adding one before the first device build had ever
// succeeded was a risk worth not taking. That reason expired: a hundred builds
// have shipped since, and expo-file-system is a declared dependency now.
//
// It mattered. A backup carries the voice notes inside it, so half a megabyte
// is an ordinary export rather than an extreme one, and the phone answered
// "too large to send from here — export from the browser instead". A backup you
// can only take on a computer is one that does not get taken.

// Only the fallback below is a message rather than a file, and past this a
// message is the wrong tool: it will be a spinner rather than a saved file.
export const SHARE_LIMIT = 512 * 1024;

// 'saved'      — written, or handed to something that writes it
// 'cancelled'  — the sheet was dismissed; nothing is wrong
// 'toolarge'   — no route on this platform can carry it
// 'unavailable'— nothing here can save a file at all
export async function saveTextFile(name, text, type = 'application/json') {
  if (typeof text !== 'string' || text === '') return 'unavailable';

  if (Platform.OS !== 'web') {
    // A real file, shared as a file. No size limit worth naming, and the sheet
    // offers "Save to Files" because it is being handed something that is one.
    //
    // iOS only, and that is the platform's doing rather than a preference:
    // Android's share module reads `message` and `title` and ignores `url`, so
    // handing it a path there shares nothing and reports that it worked.
    const shared = Platform.OS === 'ios' ? await shareNativeFile(name, text) : null;
    if (shared) return shared;

    // Nothing could be written. The old route is still better than refusing.
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

// Write it, then share the file. Returns a result, or null to fall through to
// the message route below.
async function shareNativeFile(name, text) {
  let path;
  try {
    // Imported here rather than at the top: the web bundle has no use for it.
    const { File, Paths } = await import('expo-file-system');
    const file = new File(Paths.cache, name);
    // Overwritten rather than appended to: exporting twice in one day is one
    // backup taken twice, not a file with two copies of everything in it.
    file.create({ intermediates: true, overwrite: true });
    file.write(text);
    path = file.uri;
  } catch {
    return null;
  }
  if (!path) return null;

  try {
    const result = await Share.share({ url: path, title: name });
    return result && result.action === Share.dismissedAction ? 'cancelled' : 'saved';
  } catch {
    // Written but not shared. The caller's next move is the message route,
    // which is what this did before files were an option.
    return null;
  }
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

// Choosing a file to read back in.
//
// There is no cross-platform way to do this and no file-system module in the
// project, so this is the browser's own picker, made and thrown away each time.
// A native build gets nothing here until it gets expo-document-picker, and says
// so rather than presenting a control that does nothing.
//
// Resolves to { name, text } or null — null being both "cancelled" and "could
// not", because to the person standing there they are the same thing and
// neither is a failure worth a message.
//
// No filter on what can be chosen, and that is deliberate rather than lazy.
// An accept list is a hint on a desktop and a rule on iOS, where it is matched
// against Apple's own type identifiers rather than against the extension — and
// a type it does not recognise does not narrow the picker, it greys the file
// out. A calendar exported from Proton, sitting in Files, could not be selected
// at all: the one file the person had come to fetch was the one the picker
// refused to hand over.
//
// Nothing is lost by opening it up, because the filter was never what kept a
// wrong file out. Both callers read the file and say what it is — "that file is
// not a calendar", or the restore sheet's account of what a backup contains —
// and they would have had to do that anyway, since an .ics extension is not a
// promise about what is inside.
//
// What replaces it is a size check. Without a filter somebody can pick a video,
// and readAsText on a gigabyte of film is a frozen tab rather than an error.
export const MAX_PICK_BYTES = 25 * 1024 * 1024;

// Picking a file on a phone, which this app cannot do.
//
// Worth setting down properly, because it looked available twice over.
//
// Two features reach for a file: "Read a calendar" and restoring a backup. On
// the web both open a file input. On a phone this returned null the moment it
// was called, and the callers read that as a cancellation — so both buttons did
// nothing at all when tapped, and said nothing about it. Restoring is the one
// that matters: it is the button somebody presses after losing everything.
//
// expo-file-system looks like the answer and is not. Its types declare
// File.pickFileAsync, the native module really does implement pickFileAsync —
// at module level, confirmed in FileSystemModule.swift — and no JavaScript in
// the package connects the two. The module itself is not reachable either: the
// package's `exports` map allows only "." and "./legacy", and the picker is in
// neither. The declaration is ahead of the implementation, which is a thing
// that happens, and a build is a slow way to discover it.
//
// Reading a real file on a phone needs expo-document-picker, which is a native
// module and therefore a deliberate decision rather than something to slip in.
// Until then this says so, which is the whole of the improvement: a button that
// cannot work must not look like one that was cancelled.
const NO_PICKER = 'picking a file is not available on this device yet';

function pickOnDevice() {
  return Promise.resolve({ name: '', text: null, failed: NO_PICKER });
}

export function pickTextFile() {
  if (Platform.OS !== 'web') return pickOnDevice();
  const doc = typeof document === 'undefined' ? null : document;
  const Reader = globalThis.FileReader;
  if (!doc || typeof Reader !== 'function') return Promise.resolve(null);

  return new Promise(resolve => {
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      try { input.remove(); } catch { /* already gone */ }
      resolve(value);
    };

    const input = doc.createElement('input');
    input.type = 'file';
    // Off-screen rather than hidden: a display:none input is ignored by some
    // browsers when clicked from script.
    input.style.position = 'fixed';
    input.style.left = '-10000px';

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return finish(null);
      // Said rather than silently refused: picking the wrong thing is an easy
      // mistake now that everything can be picked, and a picker that closes
      // with no explanation is indistinguishable from a broken one.
      if (typeof file.size === 'number' && file.size > MAX_PICK_BYTES) {
        return finish({ name: file.name, text: null, tooBig: true });
      }
      const reader = new Reader();
      reader.onerror = () => finish(null);
      reader.onloadend = () => finish(
        typeof reader.result === 'string' ? { name: file.name, text: reader.result } : null
      );
      reader.readAsText(file);
    });

    // Cancelling a file dialog fires nothing at all in most browsers, so the
    // promise would never settle and the sheet would sit there saying
    // "reading…" for ever. Modern browsers do fire this; the ones that do not
    // leave an input in the document, which is tidied on the next attempt.
    input.addEventListener('cancel', () => finish(null));

    doc.body.appendChild(input);
    input.click();
  });
}
