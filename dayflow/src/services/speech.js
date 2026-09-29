// Whether this device can turn speech into text, and what to do it with.
//
// On the web that is the browser's own engine, and the answer is asked for each
// time rather than remembered: it was a constant read once at load, and a window
// that came up without it had no microphone for as long as it stayed open.
//
// On a phone there is no such browser API, so the button used to be hidden —
// correctly, because one that renders and does nothing when tapped is worse than
// none. What fills that gap is Apple's own on-device recognition, wrapped by
// expo-speech-recognition in a class shaped exactly like the browser's. That
// shape is the whole reason this file is three lines of substance: everything
// that drives the microphone was written against the browser API and does not
// have to learn a second one.
//
// Required lazily and never at module scope. A build without the native module
// must behave exactly as one that never heard of it: no button, no error.

import { Platform } from 'react-native';

let native;
let looked = false;

function nativeEngine() {
  if (looked) return native;
  looked = true;
  try {
    // eslint-disable-next-line global-require
    native = require('expo-speech-recognition').ExpoWebSpeechRecognition || null;
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
  return nativeEngine();
}
