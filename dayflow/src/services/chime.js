// The sound a reminder makes.
//
// Web Audio rather than an audio file: two short tones weigh nothing, need no
// asset, and cannot fail to load. The system notification has a sound of its
// own, but only when the app is in the background and only if the OS is set to
// allow it — this is the one that plays while you are looking at the app.
//
// Browsers refuse to start audio until the page has been interacted with, so
// the context is created on the first tap or keypress and kept. Without that,
// the first reminder of a session would be silent on iOS.

let context = null;
let ready = false;

function AudioContextClass() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

// Called from the first user gesture. Safe to call repeatedly.
export function unlockChime() {
  const Ctor = AudioContextClass();
  if (!Ctor) return false;

  try {
    if (!context) context = new Ctor();
    // Created before a gesture, a context starts suspended and stays that way.
    if (context.state === 'suspended') context.resume().catch(() => {});
    ready = true;
    return true;
  } catch {
    return false;
  }
}

// Two notes, a fourth apart, short and soft. Loud enough to notice across a
// room, quiet enough not to make you jump.
const NOTES = [
  { hz: 880.0, at: 0, seconds: 0.16 },
  { hz: 1174.7, at: 0.13, seconds: 0.28 },
];

export function playChime() {
  if (!context || !ready) return false;

  try {
    if (context.state === 'suspended') context.resume().catch(() => {});
    const now = context.currentTime;

    for (const note of NOTES) {
      const osc = context.createOscillator();
      const gain = context.createGain();

      osc.type = 'sine';
      osc.frequency.value = note.hz;

      // Ramped rather than switched: an abrupt start or stop is a click.
      const start = now + note.at;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.seconds);

      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(start);
      osc.stop(start + note.seconds + 0.02);
    }
    return true;
  } catch {
    // A reminder you can see is still a reminder.
    return false;
  }
}
