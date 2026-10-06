// Calendar links — what a pasted link becomes, and how two diaries become one.
// Run with `npm test`.
import { feedUrl, linkName, mergeEvents, feedSummary } from '../src/services/calendarLink.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// The shape Proton hands out, with the key in the query string.
const PROTON = 'https://calendar.proton.me/api/calendar/v1/url/AbC123==/calendar.ics?CacheKey=x-Y_z&PassphraseKey=Pq%2Br%3D';

ok('a Proton link is taken as it is', feedUrl(PROTON) === PROTON, feedUrl(PROTON));
ok('with the spaces of a paste trimmed', feedUrl(`  ${PROTON}\n`) === PROTON);
ok('webcal:// is https:// by another name',
   feedUrl('webcal://calendar.proton.me/x/calendar.ics') === 'https://calendar.proton.me/x/calendar.ics');
ok('and so is webcals://', feedUrl('webcals://p.example.com/a.ics') === 'https://p.example.com/a.ics');
ok('plain http is refused — the link carries the key', feedUrl('http://calendar.proton.me/x.ics') === null);
ok('so is something that is not a link', feedUrl('my proton calendar') === null);
ok('and nothing at all', feedUrl('') === null && feedUrl(null) === null);

ok('a Proton link is called Proton Calendar', linkName(PROTON) === 'Proton Calendar');
ok('so is the Swiss domain', linkName('https://calendar.proton.ch/a.ics') === 'Proton Calendar');
ok('Google is Google', linkName('https://calendar.google.com/calendar/ical/x/basic.ics') === 'Google Calendar');
ok('a name it does not know is its host', linkName('https://cal.example.org/a.ics') === 'cal.example.org');
ok('and a host that only ends in the letters is not Proton',
   linkName('https://notproton.me/a.ics') === 'notproton.me', linkName('https://notproton.me/a.ics'));

const at = h => new Date(2026, 9, 5, h, 0);
const device = [{ title: 'Dentist', start: at(9) }, { title: 'Standup', start: at(10) }];
const feed = [{ title: 'standup ', start: at(10) }, { title: 'Copper NDA call', start: at(14) }];
const both = mergeEvents(device, feed);
ok('the phone and the link become one diary', both.length === 3, JSON.stringify(both.map(e => e.title)));
ok('with a meeting in both booked once', both.filter(e => /standup/i.test(e.title)).length === 1);
ok('and nothing from either lost', both.some(e => e.title === 'Dentist') && both.some(e => e.title === 'Copper NDA call'));
ok('a link alone is the link', mergeEvents([], feed).length === 2);

// ── What a connected calendar is actually giving you ────────────────────────
//
// "TA · 1 ahead · read today" cannot be acted on. A calendar holding four
// hundred meetings of which one falls in the next three weeks, and a calendar
// holding one meeting, read identically — and they need opposite fixes.
{
  const line = (feed, age) => feedSummary(feed, age);

  ok('a full calendar with nothing coming up says both numbers',
     line({ name: 'TA', events: 412, ahead: 1 }, 'read today')
       === 'TA · 412 entries · 1 coming up · read today',
     line({ name: 'TA', events: 412, ahead: 1 }, 'read today'));

  // The one the screenshot showed: one entry, one coming up. An empty calendar.
  ok('a calendar that is simply empty reads as one entry, not as a shortfall',
     line({ name: 'TA', events: 1, ahead: 1 }, 'read today')
       === 'TA · 1 entry · 1 coming up · read today',
     line({ name: 'TA', events: 1, ahead: 1 }, 'read today'));

  // The two numbers count different things, and the first draft wrote them as
  // a share of the whole — "7 of 5 in the next three weeks". One weekly meeting
  // is a single entry in the file that comes up three times in three weeks, so
  // the second number can exceed the first and the phrasing has to survive it.
  ok('a repeating meeting can come up more often than it is written down',
     line({ name: 'TA', events: 5, ahead: 7 }) === 'TA · 5 entries · 7 coming up',
     line({ name: 'TA', events: 5, ahead: 7 }));

  ok('a file nothing was read from is named as that, not as zero ahead',
     /nothing was read from it/.test(line({ name: 'TA', events: 0, ahead: 0 })),
     line({ name: 'TA', events: 0, ahead: 0 }));

  // A calendar of nothing but past meetings is the case the old line hid
  // completely: it read "0 ahead" and looked the same as a broken link.
  ok('a calendar of nothing but past meetings is distinguishable from a broken one',
     line({ name: 'TA', events: 300, ahead: 0 }) === 'TA · 300 entries · none coming up',
     line({ name: 'TA', events: 300, ahead: 0 }));

  ok('a calendar with no name still says the numbers',
     /^Linked · 9 entries · 2 coming up/.test(line({ events: 9, ahead: 2 })),
     line({ events: 9, ahead: 2 }));
  ok('and the age is left off when there is none',
     !/ · $/.test(line({ name: 'TA', events: 9, ahead: 2 })), line({ name: 'TA', events: 9, ahead: 2 }));
  ok('no feed is an empty line, not the word undefined', feedSummary(null) === '');
  ok('and rubbish counts do not become NaN',
     !/NaN/.test(line({ name: 'TA', events: 'lots', ahead: null }, 'read today')),
     line({ name: 'TA', events: 'lots', ahead: null }, 'read today'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
