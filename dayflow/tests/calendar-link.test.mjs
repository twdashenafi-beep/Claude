// Calendar links — what a pasted link becomes, and how two diaries become one.
// Run with `npm test`.
import { feedUrl, linkName, mergeEvents } from '../src/services/calendarLink.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
