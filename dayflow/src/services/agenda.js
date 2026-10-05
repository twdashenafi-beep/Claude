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

import { HANDOVER_HOUR } from './scope.js';

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
// Which day the day's page is about.
//
// Today, until the evening hands over to tomorrow.
//
// The tasks on that page already work this way: scope.js brings a task due
// tomorrow onto the day's page at nine the evening before, because at nine
// o'clock what you need is tomorrow and not the three hours left of tonight.
// The diary did not, and the result was that somebody could subscribe a
// calendar, have it read correctly three weeks deep, and still find tomorrow's
// nine o'clock meeting on no page in the app — not today, and not this week,
// which on a Sunday is over.
//
// Taking the same hour from the same constant is the point: two definitions of
// when tomorrow begins would be the bug this fixes, wearing a different hat.
export function dayInFocus(now = new Date()) {
  const at = asDate(now) || new Date();
  const focus = startOfDay(at);
  if (at.getHours() >= HANDOVER_HOUR) focus.setDate(focus.getDate() + 1);
  return focus;
}

// Whether the day's page is showing tomorrow rather than today, which anything
// putting a number on screen has to say out loud. "3h booked" under tonight's
// date, meaning tomorrow, is worse than not saying it.
export function showingTomorrow(now = new Date()) {
  const at = asDate(now) || new Date();
  return at.getHours() >= HANDOVER_HOUR;
}

// The stretch of time a page is about.
//
// The three pages are a horizon, and the diary should follow it: the day's page
// answers for today, the week's for this week, the month's for this month. The
// diary itself is read three weeks deep so that a time given to a task next
// Thursday can be checked against Thursday — which is right for that question
// and wrong for every other one, and showing all of it wherever you happened to
// be standing was the bug this fixes.
//
// The week is the calendar week, Monday to Monday, and the month the calendar
// month. Those are the weeks and months people keep: "this week" means the one
// on the wall, not the seven days in front of you.
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

  const start = dayInFocus(now);
  const to = new Date(start);
  to.setDate(to.getDate() + 1);
  return { from: start, to };
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

  // The day being reported on, which after nine in the evening is tomorrow.
  // Office hours and the events both have to come from that day; `at` stays
  // the clock, because what is left of a day is still measured from now.
  const focus = dayInFocus(at);
  const events = tidyEvents(rawEvents, focus);
  const window = dayWindow(events, focus);
  const gaps = freeGaps(events, window, at);

  return {
    span,
    focus,
    tomorrow: showingTomorrow(at),
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

// ── The day as a ruled line ──────────────────────────────────────────────────
//
// The line this page used to show was three facts with the same separator
// between them: "1h 38m booked · 7h 2m free · Free 15:52–18:00". Every item
// weighed the same, "free" meant a quantity in one clause and a place in the
// next, and the emptiest day printed the longest line. It also said 15:52,
// which is not a boundary of anything — it is what time it was when you looked.
//
// A day has a shape, and a shape is better drawn than counted. So: a hairline
// from the start of the day to the end of it, the booked stretches inked in,
// and one short caption underneath. Where the free time is becomes something
// you see rather than something you parse.
//
// The arithmetic lives here and the colours live in the component, so this can
// be tested without a screen and the component has no sums in it.

// Pixels, not percentages. Two meetings a minute apart are a minute apart on
// the clock and, as a fraction of a ten-hour day, half a pixel — which is how
// four afternoon meetings fuse into one unbroken block that nobody has. The
// gap has to be measured in the units it is seen in.
export const BAR_GAP = 2;

// A five-minute call is a hundred and twentieth of a working day — one pixel
// on a phone, and under one on a narrow column. Below this it is drawn at this
// width, growing later rather than earlier so the hour it starts stays true:
// an end a pixel out is better than a meeting that is missing.
export const BAR_LEAST = 2;

// Pixels for a list of spans already cut to the window. Shared, because a
// planned hour and a booked one are drawn by the same rules and differ only in
// how dark the ink is.
function placeSpans(spans, window, width, gap, least) {
  const total = window.to - window.from;
  if (!(total > 0) || !(width > 0)) return [];
  const across = when => ((when - window.from) / total) * width;
  const out = [];

  for (const span of spans) {
    let left = across(span.start);
    let right = across(span.end);
    if (right - left < least) right = Math.min(width, left + least);
    if (right - left < least) left = Math.max(0, right - least);

    const last = out[out.length - 1];
    if (last) {
      const lastRight = last.left + last.width;
      if (left - lastRight < gap) {
        // Either the gap is wide enough to read as a gap, or the two are one
        // block. A hairline of surface pretending to be breathing room is
        // worse than honest contiguity, so the earlier block gives up the
        // room — and if it has none to give, the two merge.
        const trimmed = left - gap - last.left;
        if (trimmed >= least) last.width = trimmed;
        else {
          last.width = Math.max(last.width, right - last.left);
          continue;
        }
      }
    }
    out.push({ left, width: right - left });
  }
  return out;
}

// Where the ink goes: one { left, width } per stretch of booked time, in
// pixels across a track of the given width.
export function barSegments(load, width, gap = BAR_GAP, least = BAR_LEAST) {
  if (!load || load.span !== 'day' || !load.window) return [];
  // mergeBusy has already cut every span to the window, so nothing here can
  // start before the day or run past the end of it.
  return placeSpans(mergeBusy(load.events, load.window), load.window, width, gap, least);
}

// Where you are standing on the day, or null when now is outside it. One tick,
// no number: the clock is already on the phone.
export function barNow(load, width, now = new Date()) {
  if (!load || load.span !== 'day' || !load.window) return null;
  if (!(width > 0)) return null;
  const total = load.window.to - load.window.from;
  if (!(total > 0)) return null;
  const at = asDate(now);
  if (!at || at < load.window.from || at > load.window.to) return null;
  return ((at - load.window.from) / total) * width;
}

// Whether there is a shape to draw at all. An empty track is not a picture of
// a free day, it is a picture of nothing, and a holiday in the diary with no
// meetings in it has no stretches to ink. Both are better said in words.
export function barDrawable(load) {
  return !!load && load.span === 'day' && load.events.length > 0 && load.committed > 0;
}

// The one fact the drawing cannot carry: how much of the day it adds up to.
//
// And which day. After nine in the evening the strip is tomorrow's, and a
// figure under tonight's date that silently means tomorrow is worse than no
// figure at all.
export function barCaption(load) {
  if (!barDrawable(load)) return null;
  const booked = `${spanMinutes(load.committed)} booked`;
  return load && load.tomorrow ? `Tomorrow  ·  ${booked}` : booked;
}

// The same day in a sentence — the fallback, and the label a screen reader
// reads off the drawing.
//
// Unlike the line it replaces, this says where the free time is once rather
// than twice, and leads with it: what is left is the thing you are deciding
// with, and what is booked is the thing you cannot change.
export function loadSentence(load, now = new Date()) {
  if (!load) return null;
  if (load.events.length === 0) return null;
  if (load.span && load.span !== 'day') return loadLine(load);

  const at = asDate(now) || new Date();
  const named = load.gaps.slice(0, 2);
  const said = named.map((gap, i) => {
    if (i > 0) return `then ${clockOf(gap.start)}–${clockOf(gap.end)}`;
    // Free already: "Free until 16:30" rather than "Free 15:52–16:30". The
    // hour it started is behind you, and 15:52 is not a boundary of anything —
    // it is what time it was when you looked, which was half the complaint.
    return gap.start - at < MINUTE
      ? `Free until ${clockOf(gap.end)}`
      : `Free ${clockOf(gap.start)}–${clockOf(gap.end)}`;
  });
  const rest = load.gaps.length - named.length;
  if (rest > 0) said.push(`and ${rest} more`);

  const where = said.length ? said.join(', ') : 'Nothing free';
  const booked = load.committed > 0 ? `${spanMinutes(load.committed)} booked` : null;
  const line = booked ? `${where}  ·  ${booked}` : where;
  // Said first, because every clock time after it belongs to a different day.
  return load.tomorrow ? `Tomorrow — ${line.charAt(0).toLowerCase()}${line.slice(1)}` : line;
}

// What tomorrow opens with, once today has nothing left in it.
//
// There is a gap between the end of a working day and nine in the evening when
// tomorrow belongs to no page. The day's page is still today and today is
// spent; the week's page is this week, which on a Sunday is over; and the
// month's page counts meetings without saying when any of them are. So
// somebody finishing at six and wondering what the morning holds had to open
// their calendar — which is the one thing a day's page exists to save them.
//
// Deliberately narrow. It says nothing while there is still something to be
// somewhere for today, nothing before the working day has closed, and nothing
// after nine, when the page has become tomorrow and the strip says it properly.
// One line, one meeting, in the hour or three where it is the only way to know.
export function tomorrowLine(load, rawEvents, now = new Date()) {
  if (!load || load.span !== 'day' || !load.window) return null;

  const at = asDate(now) || new Date();
  // The day has to be over. Otherwise a single nine o'clock meeting would have
  // the page talking about tomorrow from half past.
  //
  // This also covers the evening after nine, when the page has already become
  // tomorrow: the window is then tomorrow's own, and tonight is necessarily
  // before the close of a day that has not started. An explicit check for that
  // was written here first and taken out again — it could not be made to fail,
  // because there is no hour at which it answers anything this does not.
  if (at < load.window.to) return null;

  // Something still to be somewhere for: today is not spent.
  //
  // Not covered by the window above, and this is the whole of why it stays:
  // dayWindow only stretches the day to an event that ends before midnight, so
  // a call at eleven tonight running into tomorrow leaves the window closing
  // at six while the call is still ahead of you.
  if (load.next) return null;

  const from = startOfDay(at);
  from.setDate(from.getDate() + 1);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);

  // All-day entries are dropped: a public holiday does not start at a time,
  // and "Tomorrow starts 00:00 — Team offsite week" is worse than silence.
  const [first] = eventsWithin(rawEvents, { from, to }).filter(e => !e.allDay);
  if (!first) return null;
  return `Tomorrow starts ${clockOf(first.start)} — ${first.title}`;
}

// ── Putting work into the free time ─────────────────────────────────────────
//
// Everything above this line reports. The app could say three hours were
// booked and the afternoon was free, and say which twelve things were open,
// and the one move that joins those two facts — putting a thing into the free
// time — happened in somebody's head and then, if they remembered, in a form.
//
// It needs no new idea. A task with a date and a time is already a placed
// task: it clashes with meetings, it carries a reminder, it sorts into the
// day. All that was missing was a way to say it in one tap, and a drawing that
// shows the result next to what caused it.
//
// Still no invented durations. An hour is assumed for the slot, which is what
// this app has always booked for a task with a time on it — an assumption
// about the appointment, not about the work, which is the difference between
// this and pretending to know how long anything takes.

// The tasks a gap could hold.
//
// This was too strict in a way that made the whole thing useless. It excluded
// anything with a time on it, on the reasoning that a placed task is placed
// and offering it again is offering to move it. True of a task at eleven
// tomorrow. Not true of one that was due at nine this morning and was not
// done — and at seven in the evening, rescheduling exactly those is most of
// what anybody is tapping the strip for.
//
// So: an hour still ahead of you is a commitment and stays out of the list. An
// hour that has gone is a question, and the question is "when, then".
//
// Ordered by how much the answer is owed. Overdue first and oldest first
// within that, because a thing missed twice is worse than a thing missed once;
// then dated but untimed, nearest first; then everything else, which has no
// claim on any particular day and sits in the order it was written.
export function placeable(tasks, now = new Date()) {
  const at = asDate(now) || new Date();

  const open = (tasks || []).filter(task => {
    if (!task || task.completed || task.archivedAt) return false;
    const when = momentOf(task.dueDate, task.dueTime);
    // Already somewhere, and that somewhere has not happened yet.
    return !when || when <= at;
  });

  const rank = task => {
    const when = momentOf(task.dueDate, task.dueTime);
    if (when) return 0;
    return asDate(task.dueDate) ? 1 : 2;
  };
  const by = task => {
    const when = momentOf(task.dueDate, task.dueTime) || asDate(task.dueDate);
    return when ? when.getTime() : 0;
  };

  return open
    .map((task, i) => ({ task, i }))
    .sort((a, b) => rank(a.task) - rank(b.task) || by(a.task) - by(b.task) || a.i - b.i)
    .map(x => x.task);
}

// Which gap a tap landed on.
//
// Forgiving on purpose: a gap can be twenty pixels wide on a phone, and a
// finger is wider than that. A tap that misses falls forward to the next gap,
// because the next free time is almost always what was meant — and tapping the
// middle of a meeting to mean "after this" is a reasonable thing to do.
export function gapAt(load, width, x) {
  if (!load || load.span !== 'day' || !load.window) return null;
  if (!(width > 0) || !load.gaps || load.gaps.length === 0) return null;
  const total = load.window.to - load.window.from;
  if (!(total > 0)) return null;

  const at = new Date(load.window.from.getTime()
    + (Math.max(0, Math.min(width, x)) / width) * total);
  return load.gaps.find(g => at >= g.start && at < g.end)
    || load.gaps.find(g => g.start >= at)
    || load.gaps[load.gaps.length - 1];
}

// What to write on a task to put it in a gap.
//
// The start of the gap rather than the middle of it: a thing you have decided
// to do at two o'clock is a thing you do at two o'clock.
export function planFor(gap) {
  if (!gap || !gap.start) return null;
  const at = asDate(gap.start);
  if (!at) return null;
  return {
    dueDate: at.toISOString(),
    dueTime: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
  };
}

// Where the planned hours sit on the strip.
//
// Drawn from the tasks rather than the diary, and in a lighter ink by the
// component, because a plan and an appointment are not the same promise. One
// is where you have to be; the other is where you said you would be, to
// yourself, and the day will tell you which of those it believed.
export function barPlans(load, tasks, width, minutes = ASSUMED_MINUTES,
  gap = BAR_GAP, least = BAR_LEAST) {
  if (!load || load.span !== 'day' || !load.window) return [];
  if (!(width > 0)) return [];

  const spans = [];
  for (const task of tasks || []) {
    if (!task || task.completed || task.archivedAt) continue;
    const at = momentOf(task.dueDate, task.dueTime);
    if (!at) continue;
    const start = new Date(Math.max(at, load.window.from));
    const end = new Date(Math.min(at.getTime() + minutes * MINUTE, load.window.to));
    if (end <= start) continue;
    spans.push({ start, end, title: task.title, id: task.id });
  }
  spans.sort((a, b) => a.start - b.start);

  // Positioned by the same rule as the meetings, so a plan at two and a
  // meeting at two line up rather than each being a pixel out in its own way.
  const placed = placeSpans(spans, load.window, width, gap, least);
  return placed.map((seg, i) => ({ ...seg, title: spans[i] && spans[i].title }));
}

// Tomorrow's free time, for the hours when today has none.
//
// From the close of a working day until nine in the evening, tapping the strip
// had nothing to offer: today is spent, and the page has not yet handed over.
// Answering "nothing free is left today" is honest and no use — the page is
// already saying what tomorrow opens with, two lines above, so the thing
// somebody is reaching for when they tap at seven is tomorrow.
//
// Built from the same spanLoad as any other day, asked at a minute past
// midnight so the whole of it is still ahead and every gap is offered.
export function tomorrowGaps(rawEvents, now = new Date()) {
  const at = asDate(now) || new Date();
  const start = startOfDay(at);
  start.setDate(start.getDate() + 1);
  start.setMinutes(1);
  return spanLoad([], rawEvents, start, 'day').gaps;
}

// Putting something off.
//
// The free-time sheet asks one question — shall I do this tomorrow — and
// accepted only one answer. Going down a list of things you are not ready for
// and having no way to say so is the sheet asking a question it will not let
// you answer.
//
// Two answers, because they are two different decisions and merging them would
// quietly do the wrong one. Putting a task off changes when it is due, which is
// a promise being moved. Filing it under the month changes which page it sits
// on and touches no promise at all — it is still overdue if it was overdue, and
// the page will still say so.
//
// Counted from today rather than from the date it carries. A thing eight months
// overdue, put off by a month, is seven months overdue — which is arithmetic
// doing the opposite of what was asked.
// A week or a month. A week is the commoner nudge by far — most things are
// not ready today and will be by Thursday — so it is what one tap gives, and
// a month is a second tap on the line that confirms the first.
//
// Named rather than numbered, and deliberately not called Week or Month in the
// interface: those words already mean pages in this app, and a button called
// Week inside a triage sheet reads as "move it to the Week page", which is a
// different thing done for different reasons.
export function putOff(task, step = 'month', now = new Date()) {
  if (!task) return null;
  const at = asDate(now) || new Date();
  const had = asDate(task.dueDate);
  const from = startOfDay(had && had > at ? had : at);

  const when = new Date(from);
  if (step === 'week') {
    when.setDate(when.getDate() + 7);
  } else {
    when.setMonth(when.getMonth() + 1);
    // The last of a short month: 31 January put off by a month is the end of
    // February, not the third of March.
    if (when.getDate() !== from.getDate()) when.setDate(0);
  }

  // The hour is kept if it had one. A payroll run put off to November is still
  // a nine o'clock job, and dropping the time would lose something nobody
  // asked to lose.
  return { dueDate: when.toISOString(), dueTime: task.dueTime || '' };
}
