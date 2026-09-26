// Reading a calendar file.
//
// A deliberate subset of RFC 5545, and the tests are mostly about the parts
// real diaries are made of rather than the parts the specification is proud of:
// folded lines, a fortnightly meeting that must not drift through a clock
// change, the Tuesday somebody cancelled, and the week the meeting moved.
//
// Run under a fixed zone: every assertion here is about a wall clock.
import { parseICS, describeICS } from '../src/services/ics.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const wrap = body => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR`;
const vevent = lines => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const clock = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const day = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);
const week = (from, to) => ({ from, to });

// ── One meeting ─────────────────────────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:one@example.com',
    'SUMMARY:Board call',
    'DTSTART;TZID=Europe/London:20261002T110000',
    'DTEND;TZID=Europe/London:20261002T123000',
  ]));
  const [event] = parseICS(text, week(day(2026, 10, 2), day(2026, 10, 3)));

  ok('the meeting is found', !!event, JSON.stringify(parseICS(text, week(day(2026, 10, 2), day(2026, 10, 3)))));
  ok('with its name', event.title === 'Board call', event.title);
  ok('and its hour', clock(event.start) === '11:00', clock(event.start));
  ok('and when it ends', clock(event.end) === '12:30', clock(event.end));
  ok('and it is not an all-day thing', event.allDay === false);
}

// ── Written in UTC ──────────────────────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:utc@example.com', 'SUMMARY:Zulu',
    'DTSTART:20261002T093000Z', 'DTEND:20261002T100000Z',
  ]));
  const [event] = parseICS(text, week(day(2026, 10, 2), day(2026, 10, 3)));
  ok('a time in UTC is converted, not read off the page',
     event.start.getTime() === Date.UTC(2026, 9, 2, 9, 30), event.start.toISOString());
}

// ── All day ─────────────────────────────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:hol@example.com', 'SUMMARY:Bank holiday',
    'DTSTART;VALUE=DATE:20261002', 'DTEND;VALUE=DATE:20261003',
  ]));
  const [event] = parseICS(text, week(day(2026, 10, 2), day(2026, 10, 3)));
  ok('a bare date is an all-day event', event.allDay === true);
  ok('starting at midnight', clock(event.start) === '00:00', clock(event.start));
}

// ── A duration instead of an end ────────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:dur@example.com', 'SUMMARY:Standup',
    'DTSTART;TZID=Europe/London:20261002T093000', 'DURATION:PT15M',
  ]));
  const [event] = parseICS(text, week(day(2026, 10, 2), day(2026, 10, 3)));
  ok('a duration works as well as an end', clock(event.end) === '09:45', clock(event.end));

  const hourHalf = parseICS(wrap(vevent([
    'UID:d2@example.com', 'SUMMARY:Long', 'DTSTART:20261002T090000Z', 'DURATION:PT1H30M',
  ])), week(day(2026, 10, 2), day(2026, 10, 3)));
  ok('hours and minutes together', (hourHalf[0].end - hourHalf[0].start) === 90 * 60000,
     String((hourHalf[0].end - hourHalf[0].start) / 60000));
}

// ── Folded lines ────────────────────────────────────────────────────────────
{
  const text = wrap([
    'BEGIN:VEVENT', 'UID:fold@example.com',
    'SUMMARY:Quarterly business review with the regional dire',
    ' ctors and the finance team',
    'DTSTART;TZID=Europe/London:20261002T140000',
    'DTEND;TZID=Europe/London:20261002T150000', 'END:VEVENT',
  ].join('\r\n'));
  const [event] = parseICS(text, week(day(2026, 10, 2), day(2026, 10, 3)));
  ok('a folded title comes back in one piece',
     event.title === 'Quarterly business review with the regional directors and the finance team',
     event.title);
}

// ── Escaped text ────────────────────────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:esc@example.com', 'SUMMARY:Lunch\\, then the board\; bring the deck',
    'DTSTART:20261002T120000Z', 'DTEND:20261002T130000Z',
  ]));
  const [event] = parseICS(text, week(day(2026, 10, 2), day(2026, 10, 3)));
  ok('escaped punctuation is unescaped',
     event.title === 'Lunch, then the board; bring the deck', event.title);
}

// ── Every week ──────────────────────────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:weekly@example.com', 'SUMMARY:Monday leadership',
    'DTSTART;TZID=Europe/London:20260907T090000', 'DTEND;TZID=Europe/London:20260907T100000',
    'RRULE:FREQ=WEEKLY',
  ]));
  const out = parseICS(text, week(day(2026, 10, 5), day(2026, 10, 6)));
  ok('a weekly meeting turns up a month later', out.length === 1, String(out.length));
  ok('at the same hour', clock(out[0].start) === '09:00', clock(out[0].start));
  ok('and on the right day', out[0].start.getDate() === 5, out[0].start.toDateString());

  // Britain puts the clocks back on 25 October 2026. Stepped in milliseconds
  // this would arrive at eight.
  const after = parseICS(text, week(day(2026, 11, 2), day(2026, 11, 3)));
  ok('and still at nine after the clocks change',
     after.length === 1 && clock(after[0].start) === '09:00',
     after.map(e => clock(e.start)).join(', '));
}

// ── Every other week ────────────────────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:fort@example.com', 'SUMMARY:Fortnightly',
    'DTSTART;TZID=Europe/London:20261002T100000', 'DTEND;TZID=Europe/London:20261002T110000',
    'RRULE:FREQ=WEEKLY;INTERVAL=2',
  ]));
  ok('the week it falls on has it',
     parseICS(text, week(day(2026, 10, 16), day(2026, 10, 17))).length === 1);
  ok('and the week between does not',
     parseICS(text, week(day(2026, 10, 9), day(2026, 10, 10))).length === 0);
}

// ── Named days ──────────────────────────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:byday@example.com', 'SUMMARY:Standup',
    'DTSTART;TZID=Europe/London:20261005T093000', 'DURATION:PT15M',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
  ]));
  const out = parseICS(text, week(day(2026, 10, 5), day(2026, 10, 12)));
  ok('three a week', out.length === 3, out.map(e => e.start.toDateString()).join(' | '));
  ok('Monday, Wednesday, Friday',
     out.map(e => e.start.getDay()).join(',') === '1,3,5',
     out.map(e => e.start.getDay()).join(','));
  ok('and none before it started',
     parseICS(text, week(day(2026, 9, 28), day(2026, 10, 5))).length === 0);
}

// ── Until, and how many ─────────────────────────────────────────────────────
{
  const until = wrap(vevent([
    'UID:until@example.com', 'SUMMARY:Ends',
    'DTSTART:20261005T090000Z', 'DURATION:PT1H',
    'RRULE:FREQ=WEEKLY;UNTIL=20261019T090000Z',
  ]));
  ok('a meeting that ends, ends',
     parseICS(until, week(day(2026, 10, 26), day(2026, 10, 27))).length === 0);
  ok('and is there until it does',
     parseICS(until, week(day(2026, 10, 19), day(2026, 10, 20))).length === 1);

  const counted = wrap(vevent([
    'UID:count@example.com', 'SUMMARY:Three of them',
    'DTSTART:20261005T090000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;COUNT=3',
  ]));
  ok('three means three', parseICS(counted, week(day(2026, 10, 5), day(2026, 10, 12))).length === 3,
     String(parseICS(counted, week(day(2026, 10, 5), day(2026, 10, 12))).length));
}

// ── Monthly, and the months that have no thirty-first ───────────────────────
{
  const text = wrap(vevent([
    'UID:month@example.com', 'SUMMARY:Month end',
    'DTSTART;TZID=Europe/London:20260131T160000', 'DURATION:PT1H', 'RRULE:FREQ=MONTHLY',
  ]));
  ok('the thirty-first of March is there',
     parseICS(text, week(day(2026, 3, 31), day(2026, 4, 1))).length === 1);
  // RFC 5545 skips an occurrence that does not exist rather than moving it,
  // which is the opposite of what this app does with its own repeats.
  ok('and February is skipped rather than moved to the 28th',
     parseICS(text, week(day(2026, 2, 1), day(2026, 3, 1))).length === 0,
     JSON.stringify(parseICS(text, week(day(2026, 2, 1), day(2026, 3, 1))).map(e => e.start.toDateString())));
}

// ── Yearly ──────────────────────────────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:year@example.com', 'SUMMARY:Anniversary',
    'DTSTART;VALUE=DATE:20200402', 'DTEND;VALUE=DATE:20200403', 'RRULE:FREQ=YEARLY',
  ]));
  ok('a yearly event comes round', parseICS(text, week(day(2026, 4, 2), day(2026, 4, 3))).length === 1);
}

// ── The Tuesday somebody cancelled ──────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:ex@example.com', 'SUMMARY:Weekly one to one',
    'DTSTART;TZID=Europe/London:20261006T140000', 'DURATION:PT30M',
    'RRULE:FREQ=WEEKLY',
    'EXDATE;TZID=Europe/London:20261013T140000',
  ]));
  ok('the first one is there', parseICS(text, week(day(2026, 10, 6), day(2026, 10, 7))).length === 1);
  ok('the cancelled one is not', parseICS(text, week(day(2026, 10, 13), day(2026, 10, 14))).length === 0);
  ok('and the week after is back', parseICS(text, week(day(2026, 10, 20), day(2026, 10, 21))).length === 1);
}

// ── The week it moved ───────────────────────────────────────────────────────
{
  const text = wrap([
    vevent([
      'UID:moved@example.com', 'SUMMARY:Weekly review',
      'DTSTART;TZID=Europe/London:20261006T140000', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY',
    ]),
    vevent([
      'UID:moved@example.com', 'SUMMARY:Weekly review (moved)',
      'RECURRENCE-ID;TZID=Europe/London:20261013T140000',
      'DTSTART;TZID=Europe/London:20261015T160000', 'DURATION:PT1H',
    ]),
  ].join('\r\n'));

  ok('the Tuesday it left is empty',
     parseICS(text, week(day(2026, 10, 13), day(2026, 10, 14))).length === 0,
     JSON.stringify(parseICS(text, week(day(2026, 10, 13), day(2026, 10, 14))).map(e => e.title)));
  const thursday = parseICS(text, week(day(2026, 10, 15), day(2026, 10, 16)));
  ok('and the Thursday it moved to has it', thursday.length === 1, String(thursday.length));
  ok('at the new hour', thursday.length === 1 && clock(thursday[0].start) === '16:00',
     thursday.map(e => clock(e.start)).join(', '));
}

// ── Cancelled outright ──────────────────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:gone@example.com', 'SUMMARY:Not happening', 'STATUS:CANCELLED',
    'DTSTART:20261002T110000Z', 'DURATION:PT1H',
  ]));
  ok('a cancelled event is not on the day',
     parseICS(text, week(day(2026, 10, 2), day(2026, 10, 3))).length === 0);
}

// ── Overlapping the window ──────────────────────────────────────────────────
{
  const text = wrap(vevent([
    'UID:red@example.com', 'SUMMARY:Overnight flight',
    'DTSTART;TZID=Europe/London:20261001T220000', 'DURATION:PT9H',
  ]));
  ok('something that began yesterday and runs into today is today\'s',
     parseICS(text, week(day(2026, 10, 2), day(2026, 10, 3))).length === 1);

  const ended = wrap(vevent([
    'UID:done@example.com', 'SUMMARY:Finished before midnight',
    'DTSTART;TZID=Europe/London:20261001T220000', 'DURATION:PT1H',
  ]));
  ok('and something that finished before midnight is not',
     parseICS(ended, week(day(2026, 10, 2), day(2026, 10, 3))).length === 0);
}

// ── Junk ────────────────────────────────────────────────────────────────────
ok('an empty file has no events', parseICS('', week(day(2026, 10, 2), day(2026, 10, 3))).length === 0);
ok('and so does nothing at all', parseICS(null).length === 0);
ok('a file that is not a calendar has none either',
   parseICS('hello\nthere', week(day(2026, 10, 2), day(2026, 10, 3))).length === 0);
ok('an event with no start is dropped',
   parseICS(wrap(vevent(['UID:x', 'SUMMARY:Nowhere'])), week(day(2026, 10, 2), day(2026, 10, 3))).length === 0);
ok('an unknown repeat rule is treated as no repeat',
   parseICS(wrap(vevent([
     'UID:odd', 'SUMMARY:Odd', 'DTSTART:20261002T110000Z', 'DURATION:PT1H',
     'RRULE:FREQ=HOURLY',
   ])), week(day(2026, 10, 2), day(2026, 10, 3))).length === 1);
ok('an event with no name is still time gone',
   parseICS(wrap(vevent(['UID:n', 'DTSTART:20261002T110000Z', 'DURATION:PT1H'])),
            week(day(2026, 10, 2), day(2026, 10, 3)))[0].title === 'Busy');

// ── Looking before committing ───────────────────────────────────────────────
{
  const text = wrap([
    'X-WR-CALNAME:Work',
    vevent(['UID:a', 'SUMMARY:A', 'DTSTART:20261002T110000Z', 'DURATION:PT1H']),
    vevent(['UID:b', 'SUMMARY:B', 'DTSTART:20261003T110000Z', 'DURATION:PT1H']),
  ].join('\r\n'));
  const seen = describeICS(text);
  ok('a calendar says what it is called', seen.name === 'Work', seen.name);
  ok('and how much is in it', seen.events === 2, String(seen.events));
  ok('something that is not a calendar says so', describeICS('a shopping list') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
