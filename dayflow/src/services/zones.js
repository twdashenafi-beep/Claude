// Where a time was set.
//
// A time in this app has always been a wall clock: "11:00" means eleven o'clock
// wherever the phone happens to be standing. That is right for taking pills and
// wrong for almost everything a working diary holds. Set a call for three in
// London, fly to New York, and at three New York time the reminder arrives —
// five hours after the call. The app never decided which of the two it meant,
// so it was not behaving correctly; it was behaving arbitrarily, and the answer
// depended on where you were when you read it.
//
// So a time now records the zone it was set in, and the moment it names is that
// wall time in that zone. Three o'clock in London stays three o'clock in London
// however far you travel; the app shows it as ten in the morning while you are
// in New York, and says where it came from so the conversion is visible rather
// than mysterious.
//
// A date with no time is left alone. "Thursday" is a day, not an instant, and
// nobody crosses a date line to find their Thursday has become a Wednesday.
//
// Pure, and built on Intl rather than on a shipped copy of the zone database —
// the platform already has one, and a second would be both large and out of
// date. Where Intl cannot answer, everything here says so and the app falls
// back to the wall clock it has always used, which is the behaviour people
// already have rather than a new and worse one.

// Whether this device can do zone arithmetic at all.
//
// Hermes has shipped Intl for a while and older builds have not, and a
// formatToParts that quietly ignores timeZone would give answers that look
// right and are not. So it is checked by asking a question with a known answer
// rather than by looking for the function.
let cached = null;

export function supported() {
  if (cached !== null) return cached;
  try {
    const at = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour12: false, hour: '2-digit',
    }).formatToParts(at);
    const hour = parts.find(p => p.type === 'hour');
    // Noon UTC in mid-January is seven in the morning in New York.
    cached = !!hour && Number(hour.value) === 7;
  } catch {
    cached = false;
  }
  return cached;
}

// Only for the tests, which need to see both halves of the fallback.
export function forget() {
  cached = null;
}

export function deviceZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone ? zone : '';
  } catch {
    return '';
  }
}

export function knownZone(zone) {
  if (typeof zone !== 'string' || !zone) return false;
  if (!supported()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

// How far a zone is from UTC at a given instant, in milliseconds. Positive east.
export function offsetAt(zone, at) {
  if (!knownZone(zone)) return null;
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((all, part) => {
    all[part.type] = part.value;
    return all;
  }, {});

  // "24" for midnight, which some engines produce and Date.UTC would read as
  // the next day.
  const hour = Number(parts.hour) % 24;
  const asIfUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second),
  );
  return asIfUTC - date.getTime();
}

// The instant a wall-clock time names in a given zone.
//
// Solved rather than calculated: the offset depends on the instant and the
// instant depends on the offset. One correction settles every case but the two
// hours a year when the clocks move, and a second settles those — the guess
// lands on the far side of the change and is corrected back.
export function instantOf(year, month, day, hour, minute, zone) {
  if (!knownZone(zone)) return null;
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  let at = new Date(wanted);
  for (let pass = 0; pass < 2; pass += 1) {
    const offset = offsetAt(zone, at);
    if (offset === null) return null;
    const next = new Date(wanted - offset);
    if (next.getTime() === at.getTime()) return at;
    at = next;
  }
  return at;
}

// The wall clock a given instant shows in a given zone.
export function clockIn(zone, at) {
  const offset = offsetAt(zone, at);
  if (offset === null) return null;
  const shifted = new Date((at instanceof Date ? at.getTime() : new Date(at).getTime()) + offset);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    text: `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`,
  };
}

// Two zones are the same if they are the same name, or if they are showing the
// same clock right now. Europe/London and Europe/Dublin are different names for
// the same hour all year, and telling somebody their three o'clock is three
// o'clock is not information.
export function sameClock(a, b, at = new Date()) {
  if (!a || !b) return true;
  if (a === b) return true;
  const one = offsetAt(a, at);
  const two = offsetAt(b, at);
  if (one === null || two === null) return true;
  return one === two;
}

// "New York", "London", "Kolkata" — the last part of the name, which is what
// anybody calls it. Not the abbreviation: GMT and BST are the same place half
// the year apart, and neither is a word people navigate by.
export function zoneLabel(zone) {
  if (typeof zone !== 'string' || !zone) return '';
  const last = zone.split('/').pop() || zone;
  return last.replace(/_/g, ' ');
}
