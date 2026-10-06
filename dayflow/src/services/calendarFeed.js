// Where the day's events come from.
//
// Two sources, because there are two kinds of device and only one of them will
// hand a calendar to an app that asks.
//
//   native   the phone's own calendar, read through the OS, which expands
//            recurring meetings for us and is always current
//   feed     a calendar file you import, or the secret subscription link every
//            calendar service hands out, parsed here
//
// Both, when there are both. Proton Calendar is end-to-end encrypted and never
// hands its events to the phone's own calendar, so on an iPhone whose diary
// lives in Proton the native read succeeds — with nothing from Proton in it.
// That empty success used to win outright, and the Proton feed behind it was
// never looked at. The two are now read together and shown as one diary.
//
// The web one exists because that is the app people are using today, and a
// feature that arrives with the iOS build is a feature nobody has. It is the
// worse of the two — a file is a copy, and a copy goes stale — so the app says
// when it was last read rather than pretending otherwise.
//
// Nothing here is stored in the clear. A diary is at least as revealing as a
// task list, and the task list is encrypted on this device; a calendar sitting
// in plain text beside it would be the one unlocked drawer in the building. It
// goes through the same key as everything else.
//
// It is deliberately NOT put in the synced vault. A calendar is a copy of
// something authoritative elsewhere, each device can read its own, and pushing
// somebody's entire diary through the sync would double the size of the vault
// to no purpose.
import { Platform } from 'react-native';
import Store from './store';
import { encrypt, decrypt } from './encryption';
import { parseICS, describeICS } from './ics';
import { feedUrl, linkName, mergeEvents, shouldRefetch } from './calendarLink';

export { feedUrl };

export const FEED_KEY = '@dayflow_calendar_v1';

// How far ahead to read.
//
// The day's page only needs today, but a task being given a time can be given
// one for a week on Thursday, and answering "does that run into anything" needs
// the Thursday. Three weeks is further than anybody schedules in a task list
// and still a small enough slice of a diary to hold in memory.
const AHEAD_DAYS = 21;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── The imported file ───────────────────────────────────────────────────────

export async function saveFeed(text, key, now = new Date(), label = '', link = '') {
  const seen = describeICS(text);
  if (!seen) return null;

  // What it holds, and what it can actually show. Those are different numbers
  // and the difference is the whole diagnosis: a file of 363 events that yields
  // none for the next three weeks has parsed perfectly and is still useless,
  // and "read 363 events" says nothing about which of those two you have.
  const from = startOfDay(now);
  const to = new Date(from);
  to.setDate(to.getDate() + AHEAD_DAYS);
  let ahead = 0;
  try {
    ahead = parseICS(text, { from, to }).length;
  } catch {
    ahead = 0;
  }

  const record = {
    text: String(text),
    at: new Date(now).toISOString(),
    // Proton writes X-WR-TIMEZONE and no X-WR-CALNAME, so a calendar exported
    // from it had no name to show — which is exactly when you need one, since
    // it exports one file per calendar and the only way to tell which you
    // picked is what it is called.
    name: seen.name || String(label || '').replace(/\.ics$/i, ''),
    events: seen.events,
    ahead,
    // Kept only when the calendar came from a link, so it can be read again.
    // It is a secret — Proton's carries the key that decrypts the calendar —
    // which is one more reason the whole record is encrypted.
    ...(link ? { url: link } : {}),
  };
  await Store.setItem(FEED_KEY, encrypt(JSON.stringify(record), key));
  return record;
}

// ── The subscription link ───────────────────────────────────────────────────

const LINK_TIMEOUT_MS = 20000;

// One fetch of a given calendar at a time.
//
// A phone can fire several "came forward" events in a second, and each one asks
// for the diary. Without this they all go out, all come back, and the last one
// to land wins — three requests to say the same thing.
let inFlight = null;

// Why a link could not be read, in words that say where to look.
export class FeedLinkError extends Error {}

async function fetchCalendar(url) {
  const Abort = globalThis.AbortController;
  const abort = typeof Abort === 'function' ? new Abort() : null;
  const timer = abort ? setTimeout(() => abort.abort(), LINK_TIMEOUT_MS) : null;
  let response;
  try {
    response = await fetch(url, {
      // Asked for fresh every time. A diary fetched through a cache is a diary
      // that can be hours old while reporting itself as read just now — which
      // is the same fault as not fetching at all, wearing a newer timestamp.
      // The URL is left alone: Proton's carries its own key and query, and a
      // cache-busting parameter bolted onto that is a link it may refuse.
      cache: 'no-store',
      headers: {
        Accept: 'text/calendar, text/plain, */*',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      ...(abort ? { signal: abort.signal } : {}),
    });
  } catch (e) {
    if (Platform.OS === 'web') {
      // A browser may not read another site's file unless that site allows it,
      // and calendar services do not. The phone has no such rule.
      throw new FeedLinkError('This browser is not allowed to read that link. Add it on the phone, or import the file instead');
    }
    throw new FeedLinkError(abort && abort.signal.aborted
      ? 'The calendar took too long to answer'
      : 'Could not reach the calendar — check the connection');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new FeedLinkError('The calendar refused the link — it may have been turned off or replaced. Make a new one and paste that');
  }
  if (!response.ok) throw new FeedLinkError(`The calendar answered ${response.status}`);
  const text = await response.text();
  if (!describeICS(text)) throw new FeedLinkError('That link does not lead to a calendar');
  return text;
}

// Read a link for the first time and keep it.
export async function saveFeedLink(pasted, key, now = new Date()) {
  const url = feedUrl(pasted);
  if (!url) throw new FeedLinkError('That is not a calendar link. It starts with https:// or webcal://');
  const text = await fetchCalendar(url);
  return saveFeed(text, key, now, linkName(url), url);
}

// Read a linked calendar again whenever the app asks for the diary. A failure
// keeps the copy it had: yesterday's diary, said to be yesterday's, beats none.
//
// It used to refuse unless the copy was half an hour old, and the app asks for
// the diary every time it comes forward — so locking the phone, adding a
// meeting, and unlocking showed the diary from before, with nothing said about
// why. The rule is in calendarLink.js, where it can be tested.
export async function refreshFeed(key, now = new Date(), { force = false } = {}) {
  const feed = await readFeed(key);
  if (!shouldRefetch(feed, now, { force })) return feed;

  // Joined to whatever is already in the air rather than starting a second one.
  if (inFlight) {
    try { return (await inFlight) || feed; } catch { return feed; }
  }
  inFlight = (async () => {
    const text = await fetchCalendar(feed.url);
    return saveFeed(text, key, now, feed.name || linkName(feed.url), feed.url);
  })();
  try {
    return (await inFlight) || feed;
  } catch {
    return feed;
  } finally {
    inFlight = null;
  }
}

export async function readFeed(key) {
  try {
    const stored = await Store.getItem(FEED_KEY);
    if (!stored) return null;
    const plain = decrypt(stored, key);
    if (!plain) return null;
    const record = JSON.parse(plain);
    return record && typeof record.text === 'string' ? record : null;
  } catch {
    // A key that no longer opens it, or a half-written record. Either way there
    // is no calendar, which is a state the rest of the app already handles.
    return null;
  }
}

export async function clearFeed() {
  await Store.removeItem(FEED_KEY);
}

// ── The phone's own calendar ────────────────────────────────────────────────

// What happened the last time the phone's calendar was read — whatever it was.
//
// Not only the failures. A diary that shows nothing has four quite different
// causes: the permission was refused, the phone offered no calendars, the
// module's functions are not where the app expects them, or it read perfectly
// well and there is genuinely nothing in the next three weeks. All four look
// the same from the outside — an empty line under the date — and they are
// fixed in four different places. One of them is in iPhone Settings and not in
// this app at all, which is the case worth telling somebody about.
let reading = '';

export function calendarReading() {
  return reading;
}


// Imported only when it is going to be used. expo-calendar has nothing to offer
// a browser, and loading it there is a module that throws for no reason.
async function deviceEvents(from, to) {
  if (Platform.OS === 'web') return null;
  reading = '';
  try {
    const Calendar = await import('expo-calendar');

    // All three of these were renamed in expo-calendar 57, and the old names
    // were not kept at the package root — they moved to build/legacy. Calling
    // one that is no longer there is a TypeError, and the catch at the bottom
    // of this function turned that into "there is no calendar on this device",
    // which is exactly what a phone with the permission refused looks like.
    //
    // Both names are tried because they are two spellings of one thing and the
    // app should not care which SDK it is built against. What it must not do is
    // silently find neither, which is why that case is reported below instead
    // of returning the same null as an ordinary refusal.
    const askFor = Calendar.requestCalendarPermissions || Calendar.requestCalendarPermissionsAsync;
    const theCalendars = Calendar.getCalendars || Calendar.getCalendarsAsync;
    const theEvents = Calendar.listEvents || Calendar.getEventsAsync;

    if (!askFor || !theCalendars || !theEvents) {
      reading = 'the calendar module is not the shape this app expects';
      return null;
    }

    const { status } = await askFor();
    if (status !== 'granted') {
      // The one answer that is not a bug and not fixable from in here. iOS 17
      // asks whether to give an app the whole calendar or only the right to add
      // to it, and the second of those reads nothing — so being told where to
      // change it matters more than being told it failed.
      reading = `not allowed — ${status}. iPhone Settings › DayFlow › Calendars › Full Access`;
      return null;
    }

    const calendars = await theCalendars(Calendar.EntityTypes.EVENT);
    const ids = calendars.map(c => c.id);
    if (ids.length === 0) {
      // Allowed, and still nothing to read. On iOS 17 with write-only access
      // this is what the app is handed: a single calendar it may add to, or
      // none at all, rather than a refusal.
      reading = 'allowed, but this device offered no calendars to read';
      return [];
    }

    // Ids, not the calendar objects.
    //
    // This was briefly changed to pass the objects, on a theory about the two
    // native modules in this package spelling an id differently. The theory was
    // wrong: the build that reads this calendar correctly on a phone passes
    // ids, and that is now the only evidence either way. Changing a call that
    // demonstrably works, to satisfy an explanation of a fault it does not
    // have, is how working things stop working.
    const raw = await theEvents(ids, from, to);
    reading = `read ${calendars.length} ${calendars.length === 1 ? 'calendar' : 'calendars'}, `
      + `${raw.length} ${raw.length === 1 ? 'event' : 'events'} in the next three weeks`;
    return raw.map(event => ({
      id: event.id,
      // The app's own exports are filed with a marker, and showing them back as
      // meetings would have every dated task booking an hour against itself.
      title: String(event.title || '').replace(/^\[DayFlow\]\s*/, ''),
      start: new Date(event.startDate),
      end: new Date(event.endDate),
      allDay: !!event.allDay,
      mine: /^\[DayFlow\]/.test(String(event.title || '')),
    })).filter(event => !event.mine);
  } catch (e) {
    // Kept, rather than only returned as null. A phone that refuses permission
    // and a phone whose calendar module has moved under us look identical from
    // the outside — no diary, no complaint — and one of those is a bug.
    reading = `could not be read — ${String((e && e.message) || e)}`;
    return null;
  }
}

// ── Either one ──────────────────────────────────────────────────────────────

// Everything in the diary from today to three weeks out, or null when there is
// no calendar to read — which is not the same as a diary with nothing in it,
// and the difference is what decides whether the app says anything at all.
//
// Whoever wants one day's worth filters it down; tidyEvents already does that,
// and does it the same way for both sources.
export async function eventsFor(day, key) {
  const from = startOfDay(day);
  const to = new Date(from);
  to.setDate(to.getDate() + AHEAD_DAYS);

  const fromDevice = await deviceEvents(from, to);
  const feed = key ? await refreshFeed(key) : null;
  let fromFeed = null;
  if (feed) {
    try { fromFeed = parseICS(feed.text, { from, to }); } catch { fromFeed = null; }
  }

  if (!fromDevice && !fromFeed) return null;
  if (!fromFeed) return { events: fromDevice, source: 'device', at: new Date() };

  const events = mergeEvents(fromDevice || [], fromFeed);
  return {
    events,
    source: 'file',
    at: new Date(feed.at),
    name: feed.name,
    linked: !!feed.url,
    alsoDevice: !!(fromDevice && fromDevice.length),
  };
}

// How old the copy is, said plainly, so nobody plans a Tuesday around a file
// they exported in March.
export function feedAge(read, now = new Date()) {
  if (!read || read.source !== 'file' || !read.at) return null;
  const days = Math.round((startOfDay(now) - startOfDay(read.at)) / 86400000);
  if (days <= 0) return 'read today';
  if (days === 1) return 'read yesterday';
  if (days < 14) return `read ${days} days ago`;
  return `read ${Math.round(days / 7)} weeks ago`;
}
