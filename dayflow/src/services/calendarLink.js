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
