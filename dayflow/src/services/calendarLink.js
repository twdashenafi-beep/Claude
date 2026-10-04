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
