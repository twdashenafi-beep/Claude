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

// Whether there is a chime to play at all. Web Audio is a browser API; on iOS
// and Android there is none, and no sound is lost by its absence — a reminder
// there arrives as a system notification, which carries the operating system's
// own sound. What would be lost is a button in Account offering to play a
// sound that cannot exist, so callers ask first.
export function chimeAvailable() {
  if (typeof window === 'undefined') return false;
  return !!(window.AudioContext || window.webkitAudioContext);
}

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
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
    ctx.resume().catch(() => {});
  }
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

// Plays, and says what happened.
//
// Returns a promise for one of:
//   'played'       the notes were scheduled against a running clock
//   'unavailable'  this platform has no Web Audio at all
//   'blocked'      the context would not start — no gesture has reached it yet
//   'failed'       scheduling threw
//
// It used to return true the moment it had asked a suspended context to
// resume, before knowing whether it had. A caller cannot tell the user
// anything useful from an answer given before the fact.
export async function playChime() {
  const ctx = ensureContext();
  if (!ctx) return 'unavailable';

  // 'suspended' is the ordinary state before a gesture. 'interrupted' is
  // Safari's, entered after a phone call or when the page loses the audio
  // session, and it is not in the spec — the old code checked only for
  // 'suspended', so an interrupted context fell through to scheduling notes
  // against a clock that was not running, and played nothing.
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
    try {
      await ctx.resume();
    } catch {
      return 'blocked';
    }
    if (ctx.state !== 'running') return 'blocked';
  }

  return schedule(ctx) ? 'played' : 'failed';
}
