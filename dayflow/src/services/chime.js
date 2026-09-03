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

function ensureContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

// Called from the first user gesture. Safe to call repeatedly.
export function unlockChime() {
  const ctx = ensureContext();
  if (!ctx) return false;
  // Created before a gesture, a context starts suspended and stays that way.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return true;
}

// Two notes, a fourth apart, short and soft. Loud enough to notice across a
// room, quiet enough not to make you jump.
const NOTES = [
  { hz: 880.0, at: 0, seconds: 0.16 },
  { hz: 1174.7, at: 0.13, seconds: 0.28 },
];

function schedule(ctx) {
  try {
    const now = ctx.currentTime;
    for (const note of NOTES) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = note.hz;

      // Ramped rather than switched: an abrupt start or stop is a click.
      const start = now + note.at;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.seconds);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + note.seconds + 0.02);
    }
    return true;
  } catch {
    // A reminder you can see is still a reminder.
    return false;
  }
}

export function playChime() {
  const ctx = ensureContext();
  if (!ctx) return false;

  // A context still suspended can be started from inside a gesture, but
  // resuming is asynchronous — scheduling notes against a suspended clock
  // plays them silently, or not at all. So wait for it.
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => schedule(ctx)).catch(() => {});
    return true;
  }
  return schedule(ctx);
}
