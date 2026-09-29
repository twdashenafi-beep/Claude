// Whether this device can turn speech into text, and what to do it with.
//
// Asked each time rather than answered once. It was a constant read as the
// module loaded, and a constant read once is a constant for the life of the
// page: a window that came up without the engine had no microphone until it was
// closed and opened again, with nothing on screen to say why. It is a property
// lookup, and the answer can change.
//
// On a phone there is none, and the button is hidden rather than rendered and
// inert — one that does nothing when tapped is worse than none. The keyboard's
// own microphone key types into the same box, and the parser cannot tell the
// difference, because it only ever sees text.
//
// It was briefly otherwise. expo-speech-recognition wraps Apple's on-device
// recogniser in a class shaped exactly like the browser's, which made the change
// three lines — but no release of it is built for Expo SDK 55, and the nearest
// one compiled and then took the app down the moment this screen first drew,
// which is the first moment anything loads that module. A native module failing
// as it registers is not something a try/catch around the require can help with.
//
// Worth revisiting when this project moves to an SDK the package has a release
// for. Not before: the build succeeding proves nothing, as it turned out.

import { Platform } from 'react-native';

export function speechEngine() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}
