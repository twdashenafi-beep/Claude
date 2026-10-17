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
    // Why none, when there are none.
    if (ahead === 0) parts.push(whyNone(feed));
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
// The half of "none coming up" that says which kind of none it is.
//
// "375 entries · none coming up" is two quite different calendars wearing one
// sentence: one whose entries have all been and gone — the wrong calendar, or
// an archive — and one whose dates this app cannot read, which is a bug here.
// Nothing told them apart, and the guessing between them took days.
function whyNone(feed) {
  const held = Math.max(0, Number(feed.events) || 0);
  // A record written before this existed carries no count. Silence beats a
  // confident nothing: "no dates this app can read" would be a lie about a
  // calendar nobody has measured.
  if (feed.readable === undefined || feed.readable === null) return 'read it again to say why';

  const readable = Math.max(0, Number(feed.readable) || 0);
  if (readable === 0) return 'no dates in it this app can read';

  const latest = Date.parse(feed.latest);
  if (!Number.isFinite(latest)) return 'no dates in it this app can read';
  const when = new Date(latest).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  // Some read and some did not, which is its own answer and a different bug
  // from none of them reading.
  if (readable < held) return `only ${readable} dated, the last on ${when}`;
  return `the last one was ${when}`;
}

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

// Why there is no diary under today's date, in a sentence, or '' when there is
// nothing worth saying.
//
// The day's strip simply was not there, and that has four causes fixed in four
// different places — one of them in iPhone Settings and not in this app at
// all. Three of them are faults and said nothing; the fourth is not a fault
// and is the only one the old behaviour was right about. Asked whether the
// strip had been removed on purpose, neither of us could tell from the screen.
//
// The fourth got no line, on the reasoning that somebody who has never linked
// a calendar and does not want one should not be told about it every day, and
// that the offer already lives in Settings.
//
// That was wrong, and the way it was wrong is worth keeping written down. A
// reinstall wipes the link — it is kept on the device, it is not in the vault
// and it is not in a copy — so after restoring a backup the app is in exactly
// this state: a calendar was linked yesterday, the tasks all came back, the
// link did not, and the page said nothing. Three days went on asking whether
// the strip had been removed on purpose. The nag I was avoiding was
// hypothetical; the silence cost real time.
//
// So it says this one too, as an offer rather than a complaint.
export function absenceLine(absence) {
  if (!absence) return '';

  // Reading it failed outright. Named rather than swallowed: this is the path
  // that was a bare `catch {}` and therefore invisible.
  if (absence.threw) return 'Nothing from the calendar — reading it went wrong';

  // A calendar is kept here and this key will not open it. The copy is intact
  // and the way back is to link it again, which is in Settings.
  if (absence.kept === 'unreadable') {
    return 'The kept calendar could not be opened — link it again in Settings';
  }

  // Opened, and then would not parse: a file that is no longer a calendar, or
  // a link that now answers with something else.
  if (absence.broke) {
    return 'The kept calendar could not be read — link it again in Settings';
  }

  // What the phone said about its own calendar. Already a sentence, and the
  // one about permissions names the setting it is fixed in, which is the whole
  // reason it is worth passing through rather than summarising.
  if (absence.reading) return `Nothing from the calendar — ${absence.reading}`;

  // Nobody has linked one on this device, which is not a fault — but saying so
  // is the difference between a page that is missing something and a page that
  // never had it.
  return 'No calendar linked on this device — add one in Settings';
}
