// The day, drawn.
//
// The line this replaces printed three facts with the same dot between them,
// used "free" as both a quantity and a place, and said 15:52 — which is not a
// boundary of anything, it is what time it was when you looked. The drawing
// answers the same questions with a shape, and this is the arithmetic under it.
//
// The pixel work is the part that looks trivial and is not. Two meetings a
// minute apart are half a pixel apart on a phone, a twenty-minute call is 2% of
// a working day, and both of those round to nothing — so the gaps that make the
// afternoon readable disappear and four meetings become one unbroken block
// nobody has. Each case below was wrong in a first draft.
//
// Run under a fixed zone: every assertion here is about clock times.
import {
  barSegments, barNow, barDrawable, barCaption, loadSentence,
  spanLoad, dayLoad, BAR_GAP, BAR_LEAST, tomorrowLine,
  barPlans, gapAt, planFor, placeable, clockOf, tomorrowGaps,
} from '../src/services/agenda.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// Friday 2 October 2026. An eight-to-six day unless the diary says otherwise,
// so a 600px track is sixty pixels to the hour and the sums can be read by eye.
const on = (hh, mm = 0) => new Date(2026, 9, 2, hh, mm);
const ev = (title, from, to, extra = {}) => ({
  id: title, title, start: from, end: to, allDay: false, ...extra,
});
const W = 600;
// Pixels per hour on a 600px track across a plain eight-to-six day.
const HOUR = W / 10;
const pxAt = (hh, mm = 0, width = W, opens = 8) =>
  ((hh + mm / 60) - opens) * (width / 10);
const near = (a, b, slack = 0.51) => Math.abs(a - b) <= slack;

// ── Where the ink goes ──────────────────────────────────────────────────────
{
  const load = dayLoad([], [ev('Board call', on(11), on(12, 30))], on(9));
  const [seg, ...rest] = barSegments(load, W);
  ok('one meeting is one block', rest.length === 0 && !!seg);
  ok('and it starts where the meeting starts', near(seg.left, pxAt(11)), String(seg && seg.left));
  ok('and ends where it ends', near(seg.left + seg.width, pxAt(12, 30)),
     String(seg && seg.width));

  ok('a track with no width has nothing to draw', barSegments(load, 0).length === 0);
  ok('nor a negative one', barSegments(load, -40).length === 0);
  ok('and neither has nothing at all', barSegments(null, W).length === 0);
}

// ── The day's bounds move, and the drawing moves with them ──────────────────
//
// A seven o'clock call widens the day rather than falling off the left end of
// it, which is the whole reason dayWindow exists.
{
  const load = dayLoad([], [ev('Early call', on(7), on(7, 30))], on(7));
  const [seg] = barSegments(load, W);
  ok('a meeting before office hours opens the day instead of overflowing',
     near(seg.left, 0), String(seg.left));
  ok('and the day is eleven hours long, so half an hour is a forty-fifth of it',
     near(seg.width, W / 22, 1), String(seg.width));
}

// ── Overlaps are one block, not two ─────────────────────────────────────────
{
  const load = dayLoad([], [
    ev('Board call', on(12), on(13)),
    ev('Double booked', on(12, 30), on(14)),
  ], on(9));
  const segs = barSegments(load, W);
  ok('a double booking is one block of unavailable time', segs.length === 1,
     JSON.stringify(segs));
  ok('spanning both of them',
     near(segs[0].left, pxAt(12)) && near(segs[0].width, 2 * HOUR), JSON.stringify(segs));
}

// ── The two pixel problems ──────────────────────────────────────────────────
{
  // Back to back with five minutes between: half a pixel of surface on a
  // phone-width track, which is no gap at all.
  const tight = dayLoad([], [
    ev('One', on(10), on(11)),
    ev('Two', on(11, 5), on(12)),
  ], on(9));
  const narrow = barSegments(tight, 180);
  ok('two meetings five minutes apart keep a gap you can see',
     narrow.length === 2 && narrow[1].left - (narrow[0].left + narrow[0].width) >= BAR_GAP,
     JSON.stringify(narrow));
  ok('and the earlier one gives up the room, so the later one still starts on time',
     near(narrow[1].left, pxAt(11, 5, 180)), JSON.stringify(narrow));

  // A fifteen-minute standup on a 120px track is 3px. Two of them a minute
  // apart cannot both keep their width and a 2px gap, so they merge rather
  // than pretending to a hairline of breathing room.
  const crammed = dayLoad([], [
    ev('A', on(10), on(10, 2)),
    ev('B', on(10, 3), on(10, 5)),
  ], on(9));
  const fused = barSegments(crammed, 120);
  ok('and when there is no room to give, the two are drawn as one block',
     fused.length === 1, JSON.stringify(fused));

  // A five-minute call is a hundred and twentieth of the day: honest arithmetic
  // renders it at one pixel on a phone, and a meeting that is missing is worse
  // than a meeting whose end is a pixel out.
  const brief = dayLoad([], [ev('Quick call', on(14), on(14, 5))], on(9));
  const [small] = barSegments(brief, 120);
  ok('a five-minute call is still visible', small.width >= BAR_LEAST, String(small.width));
  // It grows later, never earlier: when the meeting starts is the fact you act
  // on, and a block drawn five minutes early says be somewhere you need not be.
  ok('and keeps the hour it actually starts', near(small.left, pxAt(14, 0, 120)),
     JSON.stringify(small));
  ok('and stays inside the track', small.left + small.width <= 120.001,
     JSON.stringify(small));

  // The same call against the end of the day: it cannot be widened rightwards
  // without hanging off the track, so it grows the other way instead.
  const last = dayLoad([], [ev('Last word', on(17, 55), on(18))], on(9));
  const [edge] = barSegments(last, 120);
  ok('a call in the last five minutes is widened inwards, not off the end',
     edge.width >= BAR_LEAST && edge.left + edge.width <= 120.001, JSON.stringify(edge));
}

// ── Nothing hangs off either end ────────────────────────────────────────────
{
  // An evening meeting opens the day rather than overflowing it: eight o'clock
  // dinner moves the boundary, and the block ends flush with the new one.
  const late = dayLoad([], [ev('Dinner', on(19), on(21))], on(9));
  const [seg] = barSegments(late, W);
  ok('a late meeting ends flush with the end of the day',
     near(seg.left + seg.width, W), JSON.stringify(seg));

  // Running into the small hours is the case the day cannot widen to hold: a
  // boundary past midnight would make "the day" two days. So the block is cut
  // at six, and the hours after it are tomorrow's problem.
  const overnight = dayLoad(
    [], [ev('Long haul', on(17), new Date(2026, 9, 3, 2))], on(9),
  );
  const [far] = barSegments(overnight, W);
  ok('a meeting into the small hours is cut at the end of the day',
     near(far.left, pxAt(17)) && near(far.left + far.width, W), JSON.stringify(far));

  // Began yesterday evening, runs into this morning. This morning is gone, and
  // the part that was yesterday is not this day's to draw.
  const redEye = dayLoad([], [ev('Red-eye', new Date(2026, 9, 1, 22), on(9))], on(9, 30));
  const [red] = barSegments(redEye, W);
  ok('a meeting that began yesterday is clipped to today', near(red.left, 0),
     JSON.stringify(red));
  // The day opens at eight and the red-eye lands at nine: one hour of it is
  // today's, and the ten hours that were yesterday are not this day's to draw.
  ok('and ends where it actually ends', near(red.left + red.width, HOUR),
     JSON.stringify(red));
}

// ── Where you are standing ──────────────────────────────────────────────────
{
  const load = dayLoad([], [ev('Board call', on(11), on(12))], on(13));
  ok('the tick is at the right hour', near(barNow(load, W, on(13)), pxAt(13)),
     String(barNow(load, W, on(13))));
  ok('before the day opens there is no tick', barNow(load, W, on(6)) === null);
  ok('and after it closes there is none either', barNow(load, W, on(23)) === null);
  ok('no width, no tick', barNow(load, 0, on(13)) === null);
  ok('a week has no tick, because it has no shape here',
     barNow(spanLoad([], [ev('x', on(11), on(12))], on(13), 'week'), W, on(13)) === null);
}

// ── Whether there is a shape at all ─────────────────────────────────────────
{
  ok('a day with meetings is drawn',
     barDrawable(dayLoad([], [ev('Board call', on(11), on(12))], on(9))));
  ok('an empty day is not', !barDrawable(dayLoad([], [], on(9))));
  // A public holiday is worth knowing about and is emphatically not six hours
  // of meetings. An empty track is a picture of nothing, so it is said in words.
  ok('a day holding only an all-day note is not drawn either',
     !barDrawable(dayLoad([], [ev('Team offsite', on(0), on(24), { allDay: true })], on(9))));
  ok('a week is not drawn', !barDrawable(spanLoad([], [ev('x', on(11), on(12))], on(9), 'week')));
  ok('and nothing at all is not drawn', !barDrawable(null));
}

// ── The caption: the one fact the drawing cannot carry ──────────────────────
{
  const load = dayLoad([], [
    ev('Standup', on(9), on(9, 30)),
    ev('Board call', on(11), on(12, 30)),
  ], on(9));
  ok('the caption adds the hours up', barCaption(load) === '2h booked', barCaption(load));
  ok('and says nothing when there is nothing to draw',
     barCaption(dayLoad([], [], on(9))) === null);
}

// ── The sentence: the fallback, and the drawing's own label ─────────────────
{
  const load = dayLoad([], [
    ev('Standup', on(9), on(9, 30)),
    ev('Board call', on(11), on(12, 30)),
  ], on(9, 45));
  // Free right now: the hour it started is behind you, so naming it would be
  // the clock with a word in front of it.
  ok('free time already running is said as "until"',
     loadSentence(load, on(9, 45)) === 'Free until 11:00, then 12:30–18:00  ·  2h booked',
     loadSentence(load, on(9, 45)));

  // Inside a meeting: the next free stretch has not started, so it gets both ends.
  const inside = dayLoad([], [ev('Board call', on(11), on(12, 30))], on(11, 30));
  ok('free time still to come is given both ends',
     loadSentence(inside, on(11, 30)) === 'Free 12:30–18:00  ·  1h 30m booked',
     loadSentence(inside, on(11, 30)));

  const busy = dayLoad([], [ev('All of it', on(8), on(18))], on(9));
  ok('a day with nothing left says so', loadSentence(busy, on(9)) === 'Nothing free  ·  10h booked',
     loadSentence(busy, on(9)));

  const many = dayLoad([], [
    ev('A', on(10), on(11)), ev('B', on(12), on(13)), ev('C', on(14), on(15)),
  ], on(8));
  ok('two gaps are named and the rest counted',
     loadSentence(many, on(8)) === 'Free until 10:00, then 11:00–12:00, and 2 more  ·  3h booked',
     loadSentence(many, on(8)));

  ok('an empty day says nothing at all', loadSentence(dayLoad([], [], on(9)), on(9)) === null);
  ok('and nothing at all says nothing', loadSentence(null) === null);

  // A week has no shape and no afternoon to offer: it keeps the counting line.
  const week = spanLoad([], [
    ev('A', on(10), on(11)), ev('B', on(12), on(13)),
  ], on(9), 'week');
  ok('a week is counted, not laid out',
     loadSentence(week, on(9)) === '2 meetings  ·  2h booked', loadSentence(week, on(9)));
}

// ── The drawing and its label agree ─────────────────────────────────────────
//
// The caption is read off `committed` and the blocks off `mergeBusy`, which is
// two routes to the same fact. A day where they disagree is a day where the
// picture lies, so they are checked against each other.
{
  const load = dayLoad([], [
    ev('Standup', on(9), on(9, 30)),
    ev('Board call', on(11), on(12, 30)),
    ev('Double booked', on(12), on(13)),
    ev('One to one', on(16), on(16, 30)),
  ], on(9, 45));
  const inked = barSegments(load, W).reduce((t, s) => t + s.width, 0);
  const hours = load.committed / 60;
  ok('the ink adds up to the caption', near(inked, hours * HOUR, 2 * BAR_GAP),
     `${inked} vs ${hours * HOUR}`);
  ok('and the label is the same day in words',
     /3h booked$/.test(loadSentence(load, on(9, 45))), loadSentence(load, on(9, 45)));
}

// ── The evening, when the strip becomes tomorrow's ──────────────────────────
//
// From nine the day's page is about tomorrow, because that is already when a
// task due tomorrow appears on it. The strip follows, and then every number
// under tonight's date belongs to another day — so it has to say so. "3h
// booked" meaning tomorrow, unlabelled, is worse than no figure at all.
{
  const tomorrow = (d, hh, mm = 0) => new Date(2026, 9, d, hh, mm);
  const diary = [
    { id: 'a', title: 'Standup', start: tomorrow(5, 9), end: tomorrow(5, 9, 30), allDay: false },
    { id: 'b', title: 'Board', start: tomorrow(5, 11), end: tomorrow(5, 12, 30), allDay: false },
  ];

  const evening = new Date(2026, 9, 4, 21, 30);
  const load = spanLoad([], diary, evening, 'day');

  ok('after nine the strip is drawn for tomorrow', load.tomorrow === true);
  ok('and it holds tomorrow\u2019s meetings', load.events.length === 2,
     load.events.map(e => e.title).join(', '));
  ok('which is two hours of it', load.committed === 120, String(load.committed));
  ok('and the caption says which day', /^Tomorrow/.test(barCaption(load)), barCaption(load));
  ok('as does the sentence, before any clock time',
     /^Tomorrow — /.test(loadSentence(load, evening)), loadSentence(load, evening));

  // The whole of tomorrow is still ahead, so nothing is behind you yet — the
  // free time is given both ends rather than said as "until".
  ok('and tomorrow\u2019s free time is not described as already running',
     !/free until/i.test(loadSentence(load, evening)), loadSentence(load, evening));

  // An hour earlier it is still tonight, and tomorrow's meetings are not it.
  const earlier = new Date(2026, 9, 4, 19, 30);
  const tonight = spanLoad([], diary, earlier, 'day');
  ok('before nine it is still today', tonight.tomorrow === false);
  ok('and tomorrow\u2019s meetings are not on it', tonight.events.length === 0,
     tonight.events.map(e => e.title).join(', '));
  ok('so nothing is captioned Tomorrow', barCaption(tonight) === null, barCaption(tonight));

  // Today's own meetings, seen in the evening, must not leak into tomorrow.
  const todayOnly = [
    { id: 'c', title: 'Late call', start: tomorrow(4, 16), end: tomorrow(4, 17), allDay: false },
  ];
  const after = spanLoad([], todayOnly, evening, 'day');
  ok('a meeting earlier today is not tomorrow\u2019s', after.events.length === 0,
     after.events.map(e => e.title).join(', '));
}

// ── The hours when tomorrow belongs to no page ──────────────────────────────
//
// Between the end of a working day and nine in the evening, tomorrow is
// nowhere: the day's page is today and today is spent, the week's page is this
// week — which on a Sunday is already over — and the month's page counts
// meetings without saying when any of them are. Somebody finishing at six and
// wondering about the morning had to open their calendar, which is the one
// errand a day's page exists to save.
{
  const at = (day, h, mi = 0) => new Date(2026, 9, day, h, mi);
  const some = (title, a, b, allDay = false) => ({ id: title, title, start: a, end: b, allDay });
  const diary = [
    some('Late call', at(4, 16), at(4, 17)),
    some('Standup', at(5, 9), at(5, 9, 30)),
  ];
  const lineAt = now => tomorrowLine(spanLoad([], diary, now, 'day'), diary, now);

  // Still something to be somewhere for.
  ok('nothing is said while the day still holds a meeting', lineAt(at(4, 15)) === null,
     String(lineAt(at(4, 15))));
  // Spent, but the working day is not over: a single morning meeting must not
  // have the page talking about tomorrow from half past nine.
  ok('nor once it is over but the day is not', lineAt(at(4, 17)) === null,
     String(lineAt(at(4, 17))));

  const said = lineAt(at(4, 18, 30));
  ok('once the day closes, tomorrow is named', said === 'Tomorrow starts 09:00 — Standup', String(said));

  // Past nine the whole page is tomorrow and the strip says so properly.
  // Saying it twice, as a strip and a sentence under it, is noise.
  ok('and it goes quiet again when the page becomes tomorrow',
     lineAt(at(4, 21, 30)) === null, String(lineAt(at(4, 21, 30))));

  // A meeting tonight that runs past midnight. The day's window only stretches
  // to something ending before midnight, so the window closes at six while the
  // call is still ahead — and a page saying "tomorrow starts at nine" while you
  // are still due on a call at eleven has its priorities backwards.
  const overnight = [
    some('Late call', at(4, 16), at(4, 17)),
    some('Call the coast', at(4, 23), new Date(2026, 9, 5, 1)),
    some('Standup', at(5, 9), at(5, 9, 30)),
  ];
  ok('a call tonight that runs past midnight still comes first',
     tomorrowLine(spanLoad([], overnight, at(4, 18, 30), 'day'), overnight, at(4, 18, 30)) === null,
     String(tomorrowLine(spanLoad([], overnight, at(4, 18, 30), 'day'), overnight, at(4, 18, 30))));

  // A public holiday does not start at a time, and "Tomorrow starts 00:00 —
  // Team offsite week" is worse than silence.
  const holiday = [some('Team offsite week', at(5, 0), at(6, 0), true)];
  ok('an all-day entry is not something tomorrow starts with',
     tomorrowLine(spanLoad([], holiday, at(4, 18, 30), 'day'), holiday, at(4, 18, 30)) === null);

  // An empty tomorrow says nothing rather than something reassuring. The line
  // exists to name a meeting; with none to name there is nothing to say.
  const onlyToday = [some('Late call', at(4, 16), at(4, 17))];
  ok('an empty tomorrow is not announced',
     tomorrowLine(spanLoad([], onlyToday, at(4, 18, 30), 'day'), onlyToday, at(4, 18, 30)) === null);

  // A week or a month is not a day and has no tomorrow to speak of.
  ok('the week page says nothing of the kind',
     tomorrowLine(spanLoad([], diary, at(4, 18, 30), 'week'), diary, at(4, 18, 30)) === null);
  ok('and nothing at all is survived', tomorrowLine(null, diary, at(4, 18, 30)) === null);
}

// ── Putting work into the free time ─────────────────────────────────────────
//
// The one move the app could describe and never make. It could say the
// afternoon was free and say what was open, and joining those two facts
// happened in somebody's head.
//
// It needs no new idea underneath: a task with a date and a time is already a
// placed task. What is new is a tap that writes one, and a drawing that shows
// the result beside what caused it.
{
  const load = dayLoad([], [ev('Board call', on(11), on(12, 30))], on(9));
  ok('the day has two stretches of free time', load.gaps.length === 2,
     load.gaps.map(g => clockOf(g.start)).join(', '));

  // ── Which gap a finger landed on ──
  //
  // Read through a helper that survives a null, because the interesting
  // failure here is a tap that finds nothing — and a test that throws on it
  // reports no failure at all, which is the same as not testing it.
  const tapAt = x => { const g = gapAt(load, W, x); return g ? clockOf(g.start) : 'nothing'; };

  ok('a tap at the start of the day finds the morning', tapAt(0) === '09:00', tapAt(0));
  ok('a tap in the afternoon finds the afternoon', tapAt(pxAt(14)) === '12:30', tapAt(pxAt(14)));
  // A gap can be twenty pixels wide on a phone and a finger is wider, so a
  // miss has to land somewhere sensible rather than nowhere.
  ok('a tap in the middle of a meeting falls forward to the next free time',
     tapAt(pxAt(11, 45)) === '12:30', tapAt(pxAt(11, 45)));
  ok('a tap past the end of the day still lands on free time',
     gapAt(load, W, W + 200) !== null);
  ok('a day with nothing free offers nothing',
     gapAt(dayLoad([], [ev('All of it', on(8), on(18))], on(9)), W, 100) === null);
  ok('and no width means no tap', gapAt(load, 0, 10) === null);

  // ── What gets written on the task ──
  const when = planFor(load.gaps[1]) || {};
  ok('a task put in a gap takes the hour the gap starts', when.dueTime === '12:30', when.dueTime);
  ok('and the day it is on', new Date(when.dueDate).getDate() === 2, when.dueDate);
  ok('nothing in, nothing out', planFor(null) === null && planFor({}) === null);

  // ── Which tasks can be placed ──
  const tasks = [
    { id: 'a', title: 'Draft the paper' },
    { id: 'b', title: 'Already at nine', dueTime: '09:00' },
    { id: 'c', title: 'Done', completed: true },
    { id: 'd', title: 'Filed away', archivedAt: '2026-10-01T00:00:00.000Z' },
  ];
  const free = placeable(tasks);
  ok('only what is open and not already somewhere is offered',
     free.length === 1 && free[0].id === 'a', free.map(x => x.id).join(', '));
  ok('a broken list is survived', placeable(null).length === 0);

  // ── And it is drawn ──
  const placed = [{ id: 'a', title: 'Draft the paper', dueDate: on(14).toISOString(), dueTime: '14:00' }];
  const [mark = {}] = barPlans(load, placed, W);
  ok('a planned hour appears on the strip', mark.width > 0, JSON.stringify(mark));
  ok('at the hour it was planned for', near(mark.left, pxAt(14)), String(mark.left));
  ok('and an hour long, which is what this app has always booked',
     near(mark.width, HOUR), String(mark.width));
  ok('and it carries its title, for anything that needs to say what it is',
     mark.title === 'Draft the paper', String(mark.title));

  // A plan is not a meeting. Drawing a finished task would be drawing a
  // commitment that no longer exists.
  ok('a finished task is not still blocking out an hour',
     barPlans(load, [{ ...placed[0], completed: true }], W).length === 0);
  ok('nor is an archived one',
     barPlans(load, [{ ...placed[0], archivedAt: 'x' }], W).length === 0);
  ok('and a task with no time is not on the strip at all',
     barPlans(load, [{ id: 'z', title: 'Someday' }], W).length === 0);

  // Clipped to the day like everything else: an hour booked at half five does
  // not hang off the end of a day that closes at six.
  const late = [{ id: 'l', title: 'Late one', dueDate: on(17, 30).toISOString(), dueTime: '17:30' }];
  const [edge = {}] = barPlans(load, late, W);
  ok('an hour planned at half five is cut at the end of the day',
     near(edge.left + edge.width, W), JSON.stringify(edge));

  ok('a week has no slots to fill',
     barPlans(spanLoad([], [], on(9), 'week'), placed, W).length === 0);
}

// ── Tapping the strip when today is spent ───────────────────────────────────
//
// Seven in the evening: the day closed at six, nothing is free, and the first
// version of this did nothing at all when tapped. Answering "nothing free is
// left today" would be honest and no use — the page is already saying what
// tomorrow opens with, two lines above the strip, so tomorrow is what somebody
// reaching for it at seven actually wants.
{
  const d = (day, h, mi = 0) => new Date(2026, 9, day, h, mi);
  const some = (title, a, b) => ({ id: title, title, start: a, end: b, allDay: false });
  const diary = [
    some('Late call', d(5, 16), d(5, 17)),
    some('Swim', d(6, 7), d(6, 8)),
    some('Board', d(6, 11), d(6, 12, 30)),
  ];
  const evening = d(5, 19, 4);

  ok('today has nothing free left at seven',
     spanLoad([], diary, evening, 'day').gaps.length === 0);

  const ahead = tomorrowGaps(diary, evening);
  ok('so tomorrow is offered instead', ahead.length === 2,
     ahead.map(g => clockOf(g.start)).join(', '));
  // Asked at a minute past midnight so none of tomorrow is already behind you.
  ok('and all of tomorrow is offered, not the part after seven',
     clockOf(ahead[0].start) === '08:00', clockOf(ahead[0].start));
  ok('with tomorrow\u2019s own meetings taken out of it',
     clockOf(ahead[0].end) === '11:00', clockOf(ahead[0].end));

  // The hour written must be tomorrow's, or the task lands on a day that has
  // already gone — which would be the feature quietly doing the wrong thing
  // rather than nothing, and that is worse.
  const when = planFor(ahead[0]) || {};
  ok('and a task put there takes tomorrow\u2019s date',
     new Date(when.dueDate).getDate() === 6, String(when.dueDate));
  ok('at the hour the gap starts', when.dueTime === '08:00', String(when.dueTime));

  // A day whose tomorrow is solid has nothing to offer, and says so.
  const packed = [some('All of it', d(6, 0), d(7, 0))];
  ok('a tomorrow with no room in it offers nothing',
     tomorrowGaps(packed, evening).length === 0,
     String(tomorrowGaps(packed, evening).length));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
