// The parts of a calendar link that are only arithmetic on strings, kept apart
// from calendarFeed.js so the test suite can reach them without React Native.

// What was pasted, as a URL that can be fetched — or null. webcal:// is only
// https:// with a different name, and it is what Proton's own "Add to calendar"
// button hands out. Plain http is refused: the link carries the calendar's key.
//
// Matched by hand rather than with URL: React Native's URL has, in more than one
// release, thrown "not implemented" on reading .protocol and .hostname, and this
// runs on the phone. A link that will not pass this is not one to fetch.
const HTTPS = /^https:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?(?:[/?#]\S*)?$/i;

export function feedUrl(pasted) {
  const text = String(pasted || '').trim();
  if (!text) return null;
  const swapped = text.replace(/^webcals?:\/\//i, 'https://');
  return HTTPS.test(swapped) ? swapped : null;
}

function hostOf(url) {
  const found = HTTPS.exec(String(url || ''));
  return found ? found[1].toLowerCase() : '';
}

export function linkName(url) {
  const host = hostOf(url);
  if (/(^|\.)proton\.(me|ch)$/.test(host)) return 'Proton Calendar';
  if (/(^|\.)google\.com$/.test(host)) return 'Google Calendar';
  if (/(^|\.)icloud\.com$/.test(host)) return 'iCloud';
  if (/(^|\.)(outlook\.com|office365\.com|office\.com)$/.test(host)) return 'Outlook';
  return host;
}

// The phone's calendar and a linked one, as one diary. The same meeting can be
// in both — a Proton link subscribed to in the iPhone Calendar app as well as
// pasted into DayFlow — and should be booked once, not twice.
export function mergeEvents(fromDevice = [], fromFeed = []) {
  const seen = new Set();
  return [...fromDevice, ...fromFeed].filter(event => {
    const mark = `${String(event.title || '').trim().toLowerCase()}|${new Date(event.start).getTime()}`;
    if (seen.has(mark)) return false;
    seen.add(mark);
    return true;
  });
}

// What a connected calendar is actually giving you.
//
// The line used to say "TA · 1 ahead · read today", and that one number cannot
// be acted on: a calendar holding four hundred meetings of which one falls in
// the next three weeks, and a calendar holding one meeting, read identically —
// and they need opposite fixes. The first means the link points somewhere with
// nothing coming up; the second means it points at an empty calendar.
//
// Both numbers are already worked out when the file is read. Only one of them
// was ever shown. saveFeed's own comment says why this matters: "a file of 363
// events that yields none for the next three weeks has parsed perfectly and is
// still useless, and 'read 363 events' says nothing about which of those two
// you have."
export function feedSummary(feed, age = '') {
  if (!feed) return '';
  const held = Math.max(0, Number(feed.events) || 0);
  const ahead = Math.max(0, Number(feed.ahead) || 0);

  const parts = [feed.name || 'Linked'];
  if (held === 0) {
    parts.push('nothing was read from it');
  } else {
    // Two different things, so they get two different words. The first counts
    // entries in the file; the second counts occurrences in the next three
    // weeks, and one weekly meeting is a single entry that comes up three
    // times. Writing it as a share of the whole — "7 of 5" — was the first
    // draft, and it is arithmetic that cannot happen saying something that can.
    parts.push(`${held} ${held === 1 ? 'entry' : 'entries'}`);
    parts.push(ahead === 0 ? 'none coming up' : `${ahead} coming up`);
  }
  if (age) parts.push(age);
  return parts.join(' · ');
}

// Whether a linked calendar is worth fetching again.
//
// This was a freshness policy — half an hour — and it was the wrong idea. The
// app already re-reads whenever it comes forward, which is exactly the moment
// somebody has just added a meeting on their laptop and picked the phone up to
// look at it. Half an hour meant that lock, add a meeting, unlock showed
// yesterday's diary and said nothing about why.
//
// So: not a policy about staleness, a guard against a stampede. A phone can
// fire several "came forward" events in a second or two, and the only thing
// worth suppressing is the second and third fetch of the same breath.
export const LINK_SETTLE_MS = 10000;

export function shouldRefetch(feed, now = new Date(), opts = {}) {
  if (!feed || !feed.url) return false;
  if (opts.force) return true;

  const settle = Number.isFinite(opts.settle) ? opts.settle : LINK_SETTLE_MS;
  const at = Date.parse(feed.at);
  // No readable stamp means nothing is known about the copy, and the honest
  // answer to "is it current" is to go and find out.
  if (!Number.isFinite(at)) return true;

  const age = new Date(now).getTime() - at;
  if (!Number.isFinite(age)) return true;
  // A copy stamped in the future is a clock that moved, not a copy that is
  // fresh for the next six hours.
  if (age < 0) return true;
  return age >= settle;
}
