// A tap you can feel.
//
// Picking a row up and putting it down are moments where the screen is the
// least useful thing: your thumb is on top of the row you are moving. A short
// buzz says "you have it" and "that one moved" without asking you to look.
//
// What is actually available depends entirely on the device, and one platform
// in particular has none of it: Safari on iOS implements no vibration API at
// all, so on an iPhone web app every call here does nothing. That is not worth
// pretending about — it is written to be silent rather than broken, and it will
// mean something on the day there is a native build.
//
// Never throws, never awaits, never blocks the gesture it belongs to.

function buzz(pattern) {
  try {
    const nav = typeof navigator === 'undefined' ? null : navigator;
    if (!nav || typeof nav.vibrate !== 'function') return false;
    return nav.vibrate(pattern) !== false;
  } catch {
    return false;
  }
}

// The row has come up off the page and is now following your thumb.
export function liftTick() {
  return buzz(18);
}

// It has passed another row and would now land somewhere new. Lighter than the
// lift: this one can happen a dozen times in a single drag.
export function moveTick() {
  return buzz(8);
}

// Put down.
export function dropTick() {
  return buzz([12, 40, 12]);
}
