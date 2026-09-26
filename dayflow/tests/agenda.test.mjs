// The hours that are already spoken for.
//
// The arithmetic here is the kind that looks obvious and is not: overlapping
// meetings are one block of unavailable time and not two, a gap is measured
// from now rather than from breakfast, and a meeting that began yesterday
// evening still takes this morning's time. Each of those was wrong in a first
// draft of this file.
//
// Run with `npm test` under a fixed zone: half the assertions are about clock
// times, and a test that passes in London and fails in Lagos is not a test.
import {
  tidyEvents, dayWindow, mergeBusy, committedMinutes, freeGaps, freeMinutes,
  clashes, spanMinutes, clockOf, dayLoad, loadLine, gapsLine, LEAST_USEFUL_GAP,
  momentOf, clashNote, spanWindow, spanLoad, eventsWithin,
} from '../src/services/agenda.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// Friday 2 October 2026.
const DAY = new Date('2026-10-02T09:30:00');
const on = (hh, mm = 0) => new Date(2026, 9, 2, hh, mm);
const ev = (title, from, to, extra = {}) => ({
  id: title, title, start: from, end: to, allDay: false, ...extra,
});

// ── Tidying what the device hands over ──────────────────────────────────────
{
  const raw = [
    ev('Board call', on(11), on(12)),
    ev('Standup', on(9, 30), on(9, 45)),
    null,
    { title: 'No dates at all' },
    { title: 'Backwards', start: on(15), end: on(14) },
    // Yesterday evening into this morning: this morning's time is still gone.
    ev('Red-eye', new Date(2026, 9, 1, 22), on(7)),
    // Tomorrow. Not this day's problem.
    ev('Next day', new Date(2026, 9, 3, 10), new Date(2026, 9, 3, 11)),
    { id: 'hol', title: 'Bank holiday', start: on(0), end: on(24), allDay: true },
  ];
  const events = tidyEvents(raw, DAY);

  ok('the rubbish is dropped', !events.some(e => e.title === 'No dates at all'),
     events.map(e => e.title).join(', '));
  ok('and so is an event that ends before it starts',
     !events.some(e => e.title === 'Backwards'));
  ok('tomorrow is not today', !events.some(e => e.title === 'Next day'));
  ok('but last night running into this morning is', events.some(e => e.title === 'Red-eye'));
  ok('an all-day event is kept', events.some(e => e.allDay));
  // The all-day event sorts to the top, where it belongs: it is the frame the
  // day sits in rather than an appointment among the others.
  const timed = events.filter(e => !e.allDay).map(e => e.title);
  ok('in order of when they start',
     timed.join(',') === 'Red-eye,Standup,Board call', timed.join(', '));
  ok('with the all-day one at the head of it', events[1].allDay,
     events.map(e => e.title).join(', '));
  ok('an event with no name is still an hour gone',
     tidyEvents([ev('', on(10), on(11))], DAY)[0].title === 'Busy');

  // An event given as an ISO string, which is what a file gives you.
  const fromText = tidyEvents([{ title: 'Typed', start: on(13).toISOString(), end: on(14).toISOString() }], DAY);
  ok('dates written as text are understood', fromText.length === 1 && fromText[0].start.getHours() === 13);
}

// ── Where the day begins and ends ───────────────────────────────────────────
{
  const quiet = dayWindow([], DAY);
  ok('an empty diary is an office day',
     quiet.from.getHours() === 8 && quiet.to.getHours() === 18,
     `${clockOf(quiet.from)}–${clockOf(quiet.to)}`);

  const early = dayWindow(tidyEvents([ev('Call Singapore', on(6, 30), on(7))], DAY), DAY);
  ok('a seven o\'clock call moves the start', clockOf(early.from) === '06:30', clockOf(early.from));
  ok('and leaves the end alone', clockOf(early.to) === '18:00', clockOf(early.to));

  const late = dayWindow(tidyEvents([ev('Dinner', on(19, 30), on(22))], DAY), DAY);
  ok('a dinner moves the end', clockOf(late.to) === '22:00', clockOf(late.to));

  // An all-day event covers midnight to midnight and must not turn the working
  // day into twenty-four hours.
  const holiday = dayWindow(tidyEvents([{ id: 'h', title: 'Leave', start: on(0), end: on(23, 59), allDay: true }], DAY), DAY);
  ok('an all-day event does not stretch the day',
     clockOf(holiday.from) === '08:00' && clockOf(holiday.to) === '18:00',
     `${clockOf(holiday.from)}–${clockOf(holiday.to)}`);
}

// ── Overlaps are one block, not two ─────────────────────────────────────────
{
  const events = tidyEvents([
    ev('Board call', on(10), on(11, 30)),
    ev('Double booked', on(11), on(12)),
    ev('Inside the other one', on(10, 15), on(10, 30)),
    ev('Later', on(14), on(15)),
  ], DAY);
  const window = dayWindow(events, DAY);
  const merged = mergeBusy(events, window);

  ok('three overlapping meetings are one block', merged.length === 2, String(merged.length));
  ok('running from the first start to the last end',
     clockOf(merged[0].start) === '10:00' && clockOf(merged[0].end) === '12:00',
     `${clockOf(merged[0].start)}–${clockOf(merged[0].end)}`);
  ok('and the time is counted once', committedMinutes(events, window) === 180,
     String(committedMinutes(events, window)));

  // Touching, not overlapping: back-to-back meetings are one block too, and
  // there is no gap between them to offer anybody.
  const backToBack = tidyEvents([ev('A', on(9), on(10)), ev('B', on(10), on(11))], DAY);
  ok('back to back is one block too',
     mergeBusy(backToBack, dayWindow(backToBack, DAY)).length === 1);

  // An all-day event is not six hours of meetings.
  const withHoliday = tidyEvents([
    { id: 'h', title: 'Leave', start: on(0), end: on(23, 59), allDay: true },
    ev('One call', on(10), on(11)),
  ], DAY);
  ok('an all-day event books no hours',
     committedMinutes(withHoliday, dayWindow(withHoliday, DAY)) === 60,
     String(committedMinutes(withHoliday, dayWindow(withHoliday, DAY))));
}

// ── What is left, and where ─────────────────────────────────────────────────
{
  const events = tidyEvents([
    ev('Standup', on(9), on(9, 30)),
    ev('Board call', on(11), on(12, 30)),
    ev('Review', on(16), on(17, 45)),
  ], DAY);
  const window = dayWindow(events, DAY);
  const gaps = freeGaps(events, window, DAY);

  // It is half past nine. The hour before that is gone whether or not anybody
  // was in a meeting for it.
  ok('the gaps start from now, not from breakfast',
     clockOf(gaps[0].start) === '09:30', clockOf(gaps[0].start));
  ok('and run up to the next thing', clockOf(gaps[0].end) === '11:00', clockOf(gaps[0].end));
  ok('every gap is found', gaps.length === 3, gaps.map(g => `${clockOf(g.start)}–${clockOf(g.end)}`).join(', '));
  ok('the last one runs to the end of the day',
     clockOf(gaps[2].start) === '17:45' && clockOf(gaps[2].end) === '18:00',
     `${clockOf(gaps[2].start)}–${clockOf(gaps[2].end)}`);
  ok('and they add up', freeMinutes(events, window, DAY) === 90 + 210 + 15,
     String(freeMinutes(events, window, DAY)));

  // Ten minutes between two meetings is the walk between them.
  const tight = tidyEvents([ev('A', on(10), on(11)), ev('B', on(11, 10), on(12))], DAY);
  const tightGaps = freeGaps(tight, dayWindow(tight, DAY), on(10));
  ok('ten minutes is not a gap',
     !tightGaps.some(g => clockOf(g.start) === '11:00'),
     tightGaps.map(g => `${clockOf(g.start)}–${clockOf(g.end)}`).join(', '));
  ok('and the threshold is the one named', LEAST_USEFUL_GAP === 15);

  // A day that is entirely gone.
  const full = tidyEvents([ev('All of it', on(8), on(18))], DAY);
  ok('a day with nothing left has no gaps',
     freeGaps(full, dayWindow(full, DAY), DAY).length === 0);

  // After the end of the working day there is nothing left to offer.
  ok('and neither has an evening',
     freeGaps(events, window, new Date(2026, 9, 2, 23)).length === 0);
}

// ── Running into a meeting ──────────────────────────────────────────────────
{
  const events = tidyEvents([
    ev('Board call', on(10, 30), on(11, 30)),
    { id: 'h', title: 'Leave', start: on(0), end: on(23, 59), allDay: true },
  ], DAY);

  ok('a task at eleven runs into the board call',
     clashes(events, on(11)).length === 1, JSON.stringify(clashes(events, on(11)).map(e => e.title)));
  ok('one at ten does too, because an hour is assumed',
     clashes(events, on(10)).length === 1);
  ok('one at half past nine does not', clashes(events, on(9, 30)).length === 0);
  ok('nor does one starting exactly as the meeting ends',
     clashes(events, on(11, 30)).length === 0);
  ok('an all-day event is not something to run into',
     !clashes(events, on(11)).some(e => e.allDay));
  ok('a shorter slot can slip in before it',
     clashes(events, on(10), 20).length === 0);
  ok('nonsense clashes with nothing', clashes(events, 'soon').length === 0);
}

// ── A date and a time, together ─────────────────────────────────────────────
{
  const iso = new Date(2026, 9, 2).toISOString();
  ok('the two make a moment', clockOf(momentOf(iso, '11:00')) === '11:00',
     String(momentOf(iso, '11:00')));
  ok('on the right day', momentOf(iso, '11:00').getDate() === 2);
  ok('a date with no time makes none, because a whole day is not an appointment',
     momentOf(iso, '') === null);
  ok('nor does a time with no date', momentOf(null, '11:00') === null);
  ok('nor does a time that is not one', momentOf(iso, '99:99') === null);
  ok('nor a date that is not one', momentOf('whenever', '11:00') === null);
}

// ── Saying so, where the time is being chosen ───────────────────────────────
{
  const day = new Date(2026, 9, 2).toISOString();
  const events = tidyEvents([
    ev('Board call', on(10, 30), on(11, 30)),
    ev('Investor lunch', on(12, 30), on(14)),
    ev('Also at eleven', on(11), on(11, 15)),
    { id: 'h', title: 'Leave', start: on(0), end: on(23, 59), allDay: true },
  ], DAY);

  ok('a clear hour says nothing', clashNote(events, day, '16:00') === null);
  ok('a whole day says nothing, whatever is in it', clashNote(events, day, '') === null);

  const one = clashNote(events, day, '12:45');
  ok('one meeting is named', /^Runs into Investor lunch/.test(one || ''), String(one));
  ok('with its own hours, because half the time that settles it',
     /12:30–14:00/.test(one || ''), String(one));

  // Eleven o'clock runs into the board call it is still inside and the
  // fifteen minutes somebody booked on top of it.
  const two = clashNote(events, day, '11:00');
  ok('two are not listed out', / and 1 other$/.test(two || ''), String(two));
  ok('and the first is still named', /^Runs into Board call/.test(two || ''), String(two));

  // A long enough slot reaches the lunch as well.
  const three = clashNote(events, day, '11:00', 180);
  ok('three are one and two others', / and 2 others$/.test(three || ''), String(three));

  ok('an all-day note is not something to run into',
     clashNote([events[0]], day, '00:30') === null);
  ok('and a shorter slot can slip in front of one',
     clashNote(events, day, '10:00', 20) === null);
  ok('no diary, nothing said', clashNote(null, day, '11:00') === null);
}

// ── Saying it ───────────────────────────────────────────────────────────────
ok('minutes under an hour stay minutes', spanMinutes(45) === '45m');
ok('a round hour says so', spanMinutes(120) === '2h');
ok('and the rest is carried', spanMinutes(105) === '1h 45m', spanMinutes(105));
ok('nothing is nothing', spanMinutes(0) === '0m');
ok('and time cannot go backwards', spanMinutes(-30) === '0m');

// ── The whole day, in one object ────────────────────────────────────────────
{
  const load = dayLoad([], [
    ev('Standup', on(9), on(9, 30)),
    ev('Board call', on(11), on(12, 30)),
  ], DAY);

  ok('the booked time is counted', load.committed === 120, String(load.committed));
  ok('the free time is what is left after now', load.free === 90 + 330, String(load.free));
  ok('the next thing to be somewhere for is named',
     load.next && load.next.title === 'Board call', load.next && load.next.title);
  ok('and the line reads as one sentence',
     loadLine(load) === '2h booked  ·  7h free', loadLine(load));
  ok('the gaps are named, the rest counted',
     gapsLine(load) === 'Free 09:30–11:00, 12:30–18:00', gapsLine(load));

  const empty = dayLoad([], [], DAY);
  ok('a day with no calendar at all says nothing', loadLine(empty) === null);
  ok('and offers no gaps to fill', gapsLine(empty) === null);

  const full = dayLoad([], [ev('All of it', on(8), on(18))], DAY);
  ok('a day with nothing left says that instead',
     loadLine(full) === '10h booked  ·  nothing free', loadLine(full));
  ok('and names no gaps', gapsLine(full) === null);

  ok('a broken list is survived', dayLoad([], null, DAY).events.length === 0);
}

// ── One page's worth of diary ───────────────────────────────────────────────
//
// The diary is read three weeks deep so a time given to a task next Thursday
// can be checked against Thursday. That depth is right for that question and
// wrong for every other one: shown on the day's page it put next week's
// meetings in front of somebody looking at today.
{
  // Friday 2 October 2026. Its week is Mon 28 Sep to Sun 4 Oct.
  const at = new Date('2026-10-02T08:00:00');
  const day = spanWindow('day', at);
  ok('a day is a day', day.from.getDate() === 2 && day.to.getDate() === 3,
     `${day.from.toDateString()} → ${day.to.toDateString()}`);
  ok('and starts at midnight', day.from.getHours() === 0);

  const week = spanWindow('week', at);
  ok('a week starts on its Monday', week.from.getDay() === 1 && week.from.getDate() === 28,
     week.from.toDateString());
  ok('and ends on the next one', week.to.getDate() === 5, week.to.toDateString());

  // From a Sunday, the week is the six days behind you and not the one ahead.
  const sunday = spanWindow('week', new Date('2026-10-04T21:00:00'));
  ok('a Sunday belongs to the week it ends', sunday.from.getDate() === 28,
     sunday.from.toDateString());

  const month = spanWindow('month', at);
  ok('a month starts on the first', month.from.getDate() === 1 && month.from.getMonth() === 9,
     month.from.toDateString());
  ok('and ends on the next first', month.to.getDate() === 1 && month.to.getMonth() === 10,
     month.to.toDateString());

  ok('anything unrecognised is a day', spanWindow('fortnight', at).to.getDate() === 3);
}

{
  const some = (d, hh, title) => ({
    id: `${title}${d}`, title,
    start: new Date(2026, 9, d, hh), end: new Date(2026, 9, d, hh + 1), allDay: false,
  });
  const diary = [
    some(2, 9, 'This morning'),
    some(2, 14, 'This afternoon'),
    some(4, 10, 'Sunday'),
    some(7, 10, 'Next week'),
    some(28, 10, 'Late October'),
    { id: 'nov', title: 'November', start: new Date(2026, 10, 3, 10), end: new Date(2026, 10, 3, 11), allDay: false },
  ];
  const at = new Date('2026-10-02T08:00:00');

  const day = spanLoad([], diary, at, 'day');
  ok('the day page sees today and nothing else', day.events.length === 2,
     day.events.map(e => e.title).join(', '));
  ok('and says what is left of it', /free/.test(loadLine(day)), loadLine(day));
  ok('and where', gapsLine(day) !== null);

  const week = spanLoad([], diary, at, 'week');
  ok('the week page sees the week', week.events.length === 3,
     week.events.map(e => e.title).join(', '));
  ok('not next week', !week.events.some(e => e.title === 'Next week'));
  ok('counted rather than measured against an afternoon',
     loadLine(week) === '3 meetings  ·  3h booked', loadLine(week));
  ok('and no gaps, because free hours spread over five days are not an afternoon',
     gapsLine(week) === null);

  const month = spanLoad([], diary, at, 'month');
  ok('the month page sees the month', month.events.length === 5,
     month.events.map(e => e.title).join(', '));
  ok('and not the next one', !month.events.some(e => e.title === 'November'));
  ok('said the same way', loadLine(month) === '5 meetings  ·  5h booked', loadLine(month));

  ok('one meeting is a meeting', loadLine(spanLoad([], [some(2, 9, 'Alone')], at, 'week'))
     === '1 meeting  ·  1h booked',
     loadLine(spanLoad([], [some(2, 9, 'Alone')], at, 'week')));
  ok('an empty week says nothing at all', loadLine(spanLoad([], [], at, 'week')) === null);

  // dayLoad is what everything else still calls, and must not have moved.
  ok('the day is still the day, however it is asked for',
     dayLoad([], diary, at).events.length === 2);

  ok('a window with no shape holds nothing', eventsWithin(diary, null).length === 0);
}

// ── Three gaps, and the line that names two ─────────────────────────────────
{
  const load = dayLoad([], [
    ev('A', on(10), on(11)),
    ev('B', on(12), on(13)),
    ev('C', on(14), on(15)),
  ], new Date(2026, 9, 2, 8));
  ok('four gaps are found', load.gaps.length === 4, String(load.gaps.length));
  ok('two are named and the rest counted',
     gapsLine(load) === 'Free 08:00–10:00, 11:00–12:00, and 2 more', gapsLine(load));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
