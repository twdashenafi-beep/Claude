// One voice note at a time.
//
// Every note owns its own player — that is what makes a row able to play
// without knowing anything about the rest of the list. It also meant that
// tapping a second note while the first was still talking played both at once,
// and the only way back was to find the first one again and stop it. Two
// recordings of your own voice over each other is not a feature anybody has
// ever wanted.
//
// So a player says here that it is about to make a noise, and everything else
// that is making one is asked to stop. This is deliberately not a store, a
// context or a provider: there is one pair of ears, the fact is global, and a
// set of stop functions is the whole of it.

const sounding = new Set();

// About to play. Everything else currently playing is stopped first.
export function claim(stop) {
  if (typeof stop !== 'function') return;
  for (const other of [...sounding]) {
    if (other === stop) continue;
    // Removed before it is called: stopping a player makes it release itself,
    // and a release part-way through this loop would otherwise be mutating the
    // set we are walking.
    sounding.delete(other);
    try {
      other();
    } catch {
      // A player that has already gone is exactly the case this is for.
    }
  }
  sounding.add(stop);
}

// Finished, stopped, or unmounted. Idempotent, because all three can happen to
// the same note and the order is not ours to choose.
export function release(stop) {
  sounding.delete(stop);
}

// For tests, and for anything that wants to know whether the app is making a
// sound.
export function playingNow() {
  return sounding.size;
}
