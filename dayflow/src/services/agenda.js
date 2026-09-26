// The hours that are already spoken for.
//
// Every page in this app has treated the day as an empty container you put
// tasks into. A day is not that. By the time anybody opens this, most of it is
// gone — eleven hours claimed by other people's meetings, with a gap here and a
// gap there — and a list of fifteen things on a day with two free hours is not
// a plan, it is a wish. The app had no way of knowing that, so it said nothing.
//
// What it will not do is invent durations. Nothing in DayFlow asks how long a
// task takes, and guessing would produce a number that looks like arithmetic
// and is not. So this reports facts a calendar can actually answer:
//
//   how much of the day is booked, and how much is left
//   where the gaps are, so a thing can be put in one
//   whether a task you have given a time to runs into a meeting
//
// and leaves the judgement where it belongs.
//
// Pure: no device, no permissions, no network. Events arrive already normalised
// to { id, title, start, end, allDay }, from the phone's calendar on native or
// from an imported file on the web, and this module does not care which.

// A working day, when the calendar gives no reason to think otherwise. Widened
// below by whatever is actually in the diary, so a seven o'clock call or an
// eight o'clock dinner moves the boundary rather than falling outside the day.
const DAY_OPENS = 8;
const DAY_CLOSES = 18;

// Shorter than this is not a gap, it is the walk between two meetings.
export const LEAST_USEFUL_GAP = 15;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function at(date, hours) {
  const d = startOfDay(date);
  d.setHours(hours, 0, 0, 0);
  return d;
}

function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Every event the day actually contains, in order, with the nonsense dropped.
//
// An all-day event is kept but marked: a public holiday or somebody's leave is
// worth knowing about and is emphatically not six hours of meetings, so it
// never counts towards the booked total.
export function tidyEvents(raw, day = new Date()) {
  return eventsWithin(raw, spanWindow('day', day));
}

// The stretch of time a page is about.
//
// The three pages are a horizon, and the diary should follow it: the day's page
// answers for today, the week's for this week, the month's for this month. The
// diary itself is read three weeks deep so that a time given to a task next
// Thursday can be checked against Thursday — which is right for that question
// and wrong for every other one, and showing all of it wherever you happened to
// be standing was the bug this fixes.
export function spanWindow(view, now = new Date()) {
  const from = startOfDay(now);

  if (view === 'week') {
    // Monday-first, like every other week in this app.
    from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    return { from, to };
  }
  if (view === 'month') {
    from.setDate(1);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 1);
    return { from, to };
  }

  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

export function eventsWithin(raw, window) {
  const from = window && window.from;
  const to = window && window.to;
  if (!from || !to) return [];

  const out = [];
  for (const event of raw || []) {
    if (!event) continue;
    const start = asDate(event.start ?? event.startDate);
    const end = asDate(event.end ?? event.endDate) || start;
    if (!start || !end || end < start) continue;
    // Overlapping the day is enough: a meeting that began yesterday evening and
    // runs into this morning takes this morning's time whatever it is called.
    if (end <= from || start >= to) continue;
    out.push({
      id: event.id || `${start.toISOString()}-${event.title || ''}`,
      title: String(event.title || '').trim() || 'Busy',
      start,
      end,
      allDay: !!event.allDay,
    });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

// Whether this is one day's worth or a longer stretch. Only a day has an
// office-hours shape, free gaps, or a sensible notion of "what is left".
function oneDay(window) {
  return (window.to - window.from) <= 25 * 60 * 60 * 1000;
}

// The span the day is judged against: office hours, widened by anything in the
// diary that falls outside them.
export function dayWindow(events, day = new Date()) {
  let from = at(day, DAY_OPENS);
  let to = at(day, DAY_CLOSES);
  const midnight = startOfDay(day);
  const nextMidnight = new Date(midnight);
  nextMidnight.setDate(nextMidnight.getDate() + 1);

  for (const event of events || []) {
    if (event.allDay) continue;
    if (event.start > midnight && event.start < from) from = event.start;
    if (event.end < nextMidnight && event.end > to) to = event.end;
  }
  if (to < from) to = from;
  return { from, to };
}

// Overlapping meetings are one block of unavailable time, not two. Double
// booking is common and counting it twice would report a nine-hour day inside
// an eight-hour one.
export function mergeBusy(events, window) {
  const spans = [];
  for (const event of events || []) {
    if (event.allDay) continue;
    const start = window ? new Date(Math.max(event.start, window.from)) : event.start;
    const end = window ? new Date(Math.min(event.end, window.to)) : event.end;
    if (end <= start) continue;
    spans.push({ start, end });
  }
  spans.sort((a, b) => a.start - b.start);

  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      if (span.end > last.end) last.end = span.end;
      continue;
    }
    merged.push({ start: new Date(span.start), end: new Date(span.end) });
  }
  return merged;
}

const MINUTE = 60000;

export function committedMinutes(events, window) {
  return mergeBusy(events, window)
    .reduce((total, span) => total + Math.round((span.end - span.start) / MINUTE), 0);
}

// What is left, and where. From `now` rather than from the start of the day:
// the hours already gone are not available however empty they were.
export function freeGaps(events, window, now = new Date(), least = LEAST_USEFUL_GAP) {
  if (!window) return [];
  const from = new Date(Math.max(window.from, asDate(now) || window.from));
  if (from >= window.to) return [];

  const gaps = [];
  let cursor = from;
  for (const span of mergeBusy(events, { from, to: window.to })) {
    if (span.start > cursor) gaps.push({ start: cursor, end: span.start });
    if (span.end > cursor) cursor = span.end;
  }
  if (cursor < window.to) gaps.push({ start: cursor, end: window.to });

  return gaps.filter(gap => (gap.end - gap.start) / MINUTE >= least);
}

export function freeMinutes(events, window, now = new Date(), least = LEAST_USEFUL_GAP) {
  return freeGaps(events, window, now, least)
    .reduce((total, gap) => total + Math.round((gap.end - gap.start) / MINUTE), 0);
}

// Which meetings a task at a given moment runs into.
//
// An hour is assumed for a task with a time on it, matching what the app
// already books when it files one in the calendar — and it is an assumption
// about the slot rather than about the work, which is the difference between
// this and inventing a duration.
export const ASSUMED_MINUTES = 60;

export function clashes(events, moment, minutes = ASSUMED_MINUTES) {
  const start = asDate(moment);
  if (!start) return [];
  const end = new Date(start.getTime() + minutes * MINUTE);
  return (events || []).filter(event =>
    !event.allDay && event.start < end && event.end > start);
}

// The moment a date and a time make together, or null when either is missing.
//
// A date on its own cannot clash with anything: a task due on Thursday is due
// some time on Thursday, and the whole day is not an appointment.
export function momentOf(dueDate, dueTime) {
  if (typeof dueTime !== 'string' || !/^\d{1,2}:\d{2}$/.test(dueTime)) return null;
  const [h, m] = dueTime.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  const at = asDate(dueDate);
  if (!at) return null;
  const when = new Date(at);
  when.setHours(h, m, 0, 0);
  return when;
}

// Said where the time is being chosen, while there is still time to choose a
// different one.
//
// Named rather than counted, because "1 conflict" tells you there is a problem
// and not whether it is one you care about. The meeting's own hours are given
// for the same reason: half the time the answer is "that one runs till twenty
// past, this is fine".
export function clashNote(events, dueDate, dueTime, minutes = ASSUMED_MINUTES) {
  const at = momentOf(dueDate, dueTime);
  if (!at) return null;

  const hit = clashes(events, at, minutes);
  if (hit.length === 0) return null;

  const [first] = hit;
  if (hit.length === 1) {
    return `Runs into ${first.title}, ${clockOf(first.start)}–${clockOf(first.end)}`;
  }
  const rest = hit.length - 1;
  return `Runs into ${first.title} and ${rest} other${rest === 1 ? '' : 's'}`;
}

// Hours and minutes, in the fewest words that are still exact.
export function spanMinutes(total) {
  const mins = Math.max(0, Math.round(total));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function clockOf(date) {
  const d = asDate(date);
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// What the day looks like, in one object.
//
// `over` is the only opinion in here, and it is a narrow one: more things with
// times on them than there are gaps to put them in. It says nothing about
// whether the untimed work will fit, because nothing in this app knows how long
// any of it takes.
export function dayLoad(tasks, rawEvents, now = new Date()) {
  return spanLoad(tasks, rawEvents, now, 'day');
}

// What one page's stretch of the diary contains.
//
// A day gets the full treatment — what is booked, what is left, and where the
// gaps are. A week or a month gets the two figures that survive being added up:
// how many meetings, and how many hours. "4h free" across a week is not a fact
// anybody can act on, and printing it would be arithmetic pretending to be
// advice.
export function spanLoad(tasks, rawEvents, now = new Date(), view = 'day') {
  const span = view === 'week' || view === 'month' ? view : 'day';
  const at = new Date(now);

  if (span !== 'day') {
    const window = spanWindow(span, at);
    const events = eventsWithin(rawEvents, window);
    return {
      span,
      events,
      window,
      gaps: [],
      committed: committedMinutes(events, window),
      free: 0,
      allDay: events.filter(e => e.allDay),
      next: events.find(e => !e.allDay && e.start > at) || null,
    };
  }

  const events = tidyEvents(rawEvents, at);
  const window = dayWindow(events, at);
  const gaps = freeGaps(events, window, at);

  return {
    span,
    events,
    window,
    gaps,
    committed: committedMinutes(events, window),
    free: gaps.reduce((total, gap) => total + Math.round((gap.end - gap.start) / MINUTE), 0),
    allDay: events.filter(e => e.allDay),
    next: events.find(e => !e.allDay && e.start > at) || null,
  };
}

// The line the day's page shows: what is booked, what is left, and — only when
// there is one — the next thing to be somewhere for.
export function loadLine(load) {
  if (!load) return null;
  if (load.events.length === 0) return null;

  // A week or a month: how many, and how long. Not what is left — free hours
  // spread across five days are not an afternoon.
  if (load.span && load.span !== 'day') {
    const timed = load.events.filter(e => !e.allDay).length;
    const said = [];
    if (timed > 0) said.push(`${timed} ${timed === 1 ? 'meeting' : 'meetings'}`);
    if (load.committed > 0) said.push(`${spanMinutes(load.committed)} booked`);
    return said.length ? said.join('  ·  ') : null;
  }

  const parts = [];
  if (load.committed > 0) parts.push(`${spanMinutes(load.committed)} booked`);
  parts.push(load.free > 0 ? `${spanMinutes(load.free)} free` : 'nothing free');
  return parts.join('  ·  ');
}

// Where the free time actually is. Two gaps named is useful; six is a timetable
// nobody reads, so it says how many are left instead.
export function gapsLine(load, most = 2) {
  if (!load || load.gaps.length === 0) return null;
  // With no calendar to read, "free 09:30–18:00" is not information about the
  // day, it is the clock with a word in front of it.
  if (load.events.length === 0) return null;
  const named = load.gaps
    .slice(0, most)
    .map(gap => `${clockOf(gap.start)}–${clockOf(gap.end)}`);
  const rest = load.gaps.length - named.length;
  return `Free ${named.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`;
}
