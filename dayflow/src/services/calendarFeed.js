// Where the day's events come from.
//
// Two sources, because there are two kinds of device and only one of them will
// hand a calendar to an app that asks.
//
//   native   the phone's own calendar, read through the OS, which expands
//            recurring meetings for us and is always current
//   web      a calendar file you import, or the secret subscription link every
//            calendar service hands out, parsed here
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { encrypt, decrypt } from './encryption';
import { parseICS, describeICS } from './ics';

export const FEED_KEY = '@dayflow_calendar_v1';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── The imported file ───────────────────────────────────────────────────────

export async function saveFeed(text, key, now = new Date()) {
  const seen = describeICS(text);
  if (!seen) return null;
  const record = { text: String(text), at: new Date(now).toISOString(), name: seen.name, events: seen.events };
  await AsyncStorage.setItem(FEED_KEY, encrypt(JSON.stringify(record), key));
  return record;
}

export async function readFeed(key) {
  try {
    const stored = await AsyncStorage.getItem(FEED_KEY);
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
  await AsyncStorage.removeItem(FEED_KEY);
}

// ── The phone's own calendar ────────────────────────────────────────────────

// Imported only when it is going to be used. expo-calendar has nothing to offer
// a browser, and loading it there is a module that throws for no reason.
async function deviceEvents(from, to) {
  if (Platform.OS === 'web') return null;
  try {
    const Calendar = await import('expo-calendar');
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') return null;

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const ids = calendars.map(c => c.id);
    if (ids.length === 0) return [];

    const raw = await Calendar.getEventsAsync(ids, from, to);
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
  } catch {
    return null;
  }
}

// ── Either one ──────────────────────────────────────────────────────────────

// How far ahead to read.
//
// The day's page only needs today, but a task being given a time can be given
// one for a week on Thursday, and answering "does that run into anything" needs
// the Thursday. Three weeks is further than anybody schedules in a task list
// and still a small enough slice of a diary to hold in memory.
const AHEAD_DAYS = 21;

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
  if (fromDevice) return { events: fromDevice, source: 'device', at: new Date() };

  if (!key) return null;
  const feed = await readFeed(key);
  if (!feed) return null;

  return {
    events: parseICS(feed.text, { from, to }),
    source: 'file',
    at: new Date(feed.at),
    name: feed.name,
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
