// How long opening the vault took, and which part of it took that long.
//
// Unlocking is the one thing in this app that is slow enough to be noticed, and
// until now the only thing anybody could say about it was "about ten seconds".
// That is not enough to fix anything: the wait is three separate costs stacked
// on top of each other — deriving the key from the password, reading the vault
// off the disk, and decrypting what came back — and they are fixed in entirely
// different ways.
//
// Face ID already separated the first from the rest: it skips the derivation
// altogether, so a Face ID unlock that is still slow says the derivation was
// never the problem. This separates the other two, and inside the decrypt it
// separates the tasks that carry a recording from the tasks that do not —
// because sixteen recordings are two thirds of what is stored here and none of
// them is on the screen you are waiting for.
//
// The numbers are held in memory only and go nowhere. They are shown in
// Account → This device, next to the rest of what this device is holding.

// A count of milliseconds that works wherever this runs. performance.now() is
// the better clock and is not everywhere.
export function nowMs() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function secondsWords(ms) {
  const n = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(1)} s`;
}

// The record, as the load hands it over: named stages in the order they
// happened, and whatever the load knows about what it was working on.
let record = null;

export function beginOpening() {
  record = { startedAt: nowMs(), stages: [], total: 0 };
}

export function noteStage(name, ms) {
  if (!record) beginOpening();
  record.stages.push({ name, ms });
  record.total += ms;
}

export function openingRecord() {
  return record;
}

// For tests, which must not inherit a record from the test before.
export function forgetOpening() {
  record = null;
}

// One line, in the order the time was spent.
//
// Stages are named by whoever measured them, because a name written at the
// point of measurement stays true when the code around it moves; a lookup table
// here would not.
export function openingLine(given) {
  const it = given || record;
  if (!it || !it.stages.length) return '';
  const parts = it.stages
    .filter(stage => stage && stage.name)
    .map(stage => `${stage.name} ${secondsWords(stage.ms)}`);
  return `Opened in ${secondsWords(it.total)} — ${parts.join(' · ')}`;
}

// When the wait is long enough that somebody would complain about it.
//
// There is no point reporting two seconds; everything opens in two seconds.
// Past this, the app says so on the screen somebody is already staring at
// rather than filing it where it has to be gone looking for — which is how
// four requests for one line went unanswered while the same complaint came
// back three times. The number was always on the device and never in anybody's
// hands.
const SLOW_MS = 8000;

export function wasSlow(given) {
  const it = given || record;
  return !!it && it.total >= SLOW_MS;
}
