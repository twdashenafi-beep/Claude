// Whether this device can turn speech into text, and what to do it with.
//
// On the web that is the browser's own engine, and the answer is asked for each
// time rather than remembered: it was a constant read once at load, and a
// window that came up without it had no microphone for as long as it stayed
// open. It is a property lookup, and the answer can change.
//
// On a phone there is no such browser API. What fills the gap is Apple's own
// on-device recognition, wrapped by expo-speech-recognition in a class shaped
// exactly like the browser's — which is the whole reason this file is a few
// lines of substance rather than a second implementation of everything that
// drives the microphone.
//
// This was tried once before, on Expo SDK 55, and it took the app down the
// moment the quick-add line first drew. The cause was not the idea: no release
// of the package was built for SDK 55 — the versions run …, 3.1.3, then 56, 57,
// named for the SDK they target, and 55 is the one they skipped. A native
// module can compile against the wrong React Native and still fail as it
// registers, which is why a build succeeding proved nothing then and why the
// version alignment is the thing that matters now.
//
// Required lazily and never at module scope. A build without the native module
// must behave exactly as one that never heard of it: no button, no error.

import { Platform } from 'react-native';

let native;
let looked = false;

function nativeModule() {
  if (looked) return native;
  looked = true;
  try {
    // eslint-disable-next-line global-require
    native = require('expo-speech-recognition');
  } catch {
    native = null;
  }
  return native;
}

export function speechEngine() {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }
  const mod = nativeModule();
  return (mod && mod.ExpoWebSpeechRecognition) || null;
}

// Permission, before anything starts listening.
//
// A browser asks for the microphone by being asked to listen, so there is
// nothing to do there and nothing to wait for — which matters, because a press
// that has to wait for a promise before it starts is a press that can lose its
// gesture. A phone asks for two things, the microphone and speech recognition,
// and gives neither unless asked: start without them and the only sign is an
// error event carrying `not-allowed`, which is indistinguishable from a
// microphone that does not work.
//
// So the browser runs straight through, and the phone runs through the moment
// it has an answer — which after the first time is immediately.
export function withSpeechPermission(run, refuse) {
  if (Platform.OS === 'web') { run(); return; }
  const mod = nativeModule();
  if (!mod || !mod.ExpoSpeechRecognitionModule) { refuse(); return; }
  mod.ExpoSpeechRecognitionModule.requestPermissionsAsync()
    .then(result => (result && result.granted ? run() : refuse()))
    .catch(refuse);
}

// What is behind the microphone button, named rather than left to be inferred.
//
// A button that is not on screen looks identical whether the browser has no
// engine, the native module failed to load, or the build never contained it at
// all. That difference has cost two builds to establish by other means, and it
// is the kind of thing a device ought to be able to answer about itself.
//
// Reported in Account → This device, beside everything else this device is
// holding.
export function speechSource() {
  if (Platform.OS === 'web') {
    return speechEngine() ? 'browser' : 'no-browser-engine';
  }
  const mod = nativeModule();
  if (!mod) return 'not-in-this-build';
  return mod.ExpoWebSpeechRecognition ? 'device' : 'no-engine-in-module';
}

// Whether this device has actually been allowed to listen.
//
// speechSource answers "is there an engine here", which is a different
// question and was being read as the same one: a report saying "Dictation
// comes from this device" on a phone where the microphone button does nothing
// is a report that answered the wrong thing confidently. The engine can be
// present and permission refused — in iOS Settings, months ago, by somebody
// who has forgotten — and that is fixed in Settings rather than in this app,
// which is precisely why it has to be said rather than guessed at.
//
// getPermissionsAsync rather than request: this runs because a settings sheet
// was opened, and a sheet that throws a microphone prompt at somebody who did
// not ask for one is its own bug.
//
// Resolves to 'granted', 'refused', 'unasked', or '' when there is nothing
// here to ask — the engine's absence is already reported by speechSource and
// saying it twice in two different ways helps nobody.
export async function speechPermission() {
  if (Platform.OS === 'web') return '';
  const mod = nativeModule();
  const api = mod && mod.ExpoSpeechRecognitionModule;
  if (!api || typeof api.getPermissionsAsync !== 'function') return '';
  try {
    const result = await api.getPermissionsAsync();
    if (!result) return '';
    if (result.granted) return 'granted';
    // canAskAgain says which of the two refusals this is, and they are not the
    // same: one is answered by tapping the button, the other only in Settings.
    return result.canAskAgain ? 'unasked' : 'refused';
  } catch {
    return '';
  }
}
