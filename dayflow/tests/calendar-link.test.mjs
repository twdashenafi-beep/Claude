// Calendar links — what a pasted link becomes, and how two diaries become one.
// Run with `npm test`.
import { feedUrl, linkName, mergeEvents, feedSummary, shouldRefetch, LINK_SETTLE_MS, absenceLine }
  from '../src/services/calendarLink.js';

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
  //
  // It now carries a clause saying which kind of none it is, so this asserts
  // the first half and the block at the end of this file asserts the rest. A
  // record with no `readable` count — which is what this is — asks to be read
  // again rather than claiming anything about dates nobody has measured.
  ok('a calendar of nothing but past meetings is distinguishable from a broken one',
     line({ name: 'TA', events: 300, ahead: 0 })
       .startsWith('TA · 300 entries · none coming up'),
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

// ── When a linked calendar is worth reading again ───────────────────────────
//
// The app re-reads whenever it comes forward, and it refused to fetch unless
// the copy was half an hour old. So lock the phone, add a meeting on the
// laptop, unlock: yesterday's diary, and nothing said about why. Reported
// exactly that way — "the new meetings I put in are not in".
{
  const NOW = new Date(2026, 9, 6, 14, 0, 0);
  const ago = ms => ({ url: 'https://calendar.proton.me/x.ics', at: new Date(+NOW - ms).toISOString() });

  ok('a copy from a moment ago is not fetched again',
     shouldRefetch(ago(2000), NOW) === false);
  // The case that was broken: a lock and an unlock, a minute apart.
  ok('a copy from a minute ago is', shouldRefetch(ago(60 * 1000), NOW) === true);
  ok('and so is one from five minutes ago', shouldRefetch(ago(5 * 60 * 1000), NOW) === true);
  ok('and one from half an hour ago, as before',
     shouldRefetch(ago(30 * 60 * 1000), NOW) === true);

  // The guard is against a stampede, not against staleness: a phone can fire
  // several "came forward" events in one breath.
  ok('the settle window is seconds, not minutes', LINK_SETTLE_MS <= 15000, String(LINK_SETTLE_MS));
  ok('right on the boundary it fetches',
     shouldRefetch(ago(LINK_SETTLE_MS), NOW) === true);
  ok('and just inside it does not',
     shouldRefetch(ago(LINK_SETTLE_MS - 1), NOW) === false);

  ok('force overrides the guard entirely',
     shouldRefetch(ago(0), NOW, { force: true }) === true);

  // Nothing to fetch from.
  ok('a calendar read from a file is never fetched',
     shouldRefetch({ at: new Date(NOW).toISOString() }, NOW) === false);
  ok('and no calendar at all is not fetched', shouldRefetch(null, NOW) === false);

  // Unknown beats assumed: a copy with no readable stamp is a copy nothing is
  // known about, and the honest answer is to go and look.
  ok('a copy with no stamp is fetched',
     shouldRefetch({ url: 'https://x/y.ics' }, NOW) === true);
  ok('and one with a stamp nothing can read',
     shouldRefetch({ url: 'https://x/y.ics', at: 'whenever' }, NOW) === true);
  // A clock that moved backwards made the copy look fresh for hours.
  ok('a copy stamped in the future is fetched rather than trusted',
     shouldRefetch(ago(-6 * 60 * 60 * 1000), NOW) === true);
}

// ── Why there is no diary, said out loud ───────────────────────────────────
//
// The day's strip was simply absent when there was no calendar to draw, and
// that reads exactly like a feature that has been taken away — it was taken
// for one, and I was asked whether removing it had been deliberate. Four
// causes, fixed in four different places, one of them in iPhone Settings and
// not in this app at all. Three are faults. The fourth is somebody who has
// never linked a calendar, and telling them about it every day is the one
// thing the old behaviour got right.
{
  const IOS_PERMISSION =
    'not allowed — denied. iPhone Settings › DayFlow › Calendars › Full Access';

  // Every call goes through here. The first falsification of this block — make
  // it answer '' for everything — threw on the way past instead, which took
  // the whole run down and reported no failure at all. A throw is a failure
  // standing next to its neighbours now.
  const line = a => {
    try {
      const said = absenceLine(a);
      return typeof said === 'string' ? said : `not a string: ${typeof said}`;
    } catch (e) {
      return `threw: ${(e && e.message) || e}`;
    }
  };

  // ── The one case that stays silent ──
  ok('a diary that was read says nothing', line(null) === '');

  // ── And the one that used to, and should not have ──
  //
  // A reinstall wipes the link: it is kept on the device, not in the vault and
  // not in a copy. So after restoring a backup the app sits in exactly this
  // state — a calendar was linked yesterday, every task came back, the link
  // did not — and it said nothing, which is how three days went on asking
  // whether the strip had been taken away deliberately.
  const never = line({ kept: 'none', reading: '', broke: false, web: true });
  ok('never having linked one is said too, now', never !== '', never);
  ok('as an offer rather than a complaint', /add one in Settings/.test(never), never);
  ok('and it names the device, because the link belongs to one',
     /this device/.test(never), never);
  ok('on a phone the same as on the web',
     line({ kept: 'none', reading: '', broke: false, web: false }) === never);

  // ── The three that must not ──
  const unopened = line({ kept: 'unreadable', reading: '', broke: false });
  ok('a kept calendar this key will not open is said',
     unopened !== '' && /could not be opened/.test(unopened), unopened);
  ok('and names where it is fixed', /Settings/.test(unopened), unopened);

  const unparsed = line({ kept: 'ok', reading: '', broke: true });
  ok('a kept calendar that will not parse is said',
     unparsed !== '' && /could not be read/.test(unparsed), unparsed);
  ok('and the two are not the same sentence, because they are not the same fault',
     unopened !== unparsed, `${unopened} / ${unparsed}`);

  const refused = line({ kept: 'none', reading: IOS_PERMISSION, broke: false });
  ok('a permission the phone changed is said', refused !== '', refused);
  // Passed through rather than summarised. The sentence names the iPhone
  // setting, which is the only thing in it anybody can act on, and a tidier
  // line that dropped the path would be worth less than no line.
  ok('and carries the setting it is fixed in, word for word',
     refused.includes('iPhone Settings › DayFlow › Calendars › Full Access'), refused);

  ok('a module that has moved under us is said',
     line({ kept: 'none', reading: 'the calendar module is not the shape this app expects' })
       .includes('not the shape'), '');

  const threw = line({ threw: true });
  ok('and the read that went wrong, which was a bare catch and said nothing at all',
     threw !== '' && /went wrong/.test(threw), threw);

  // ── Which fault wins when more than one is true ──
  //
  // A copy that will not open is the nearer fact: the phone's reading is about
  // a different calendar entirely, and the way out of the first one is one tap.
  ok('a copy that will not open is named ahead of what the phone said',
     line({ kept: 'unreadable', reading: IOS_PERMISSION }) === unopened,
     line({ kept: 'unreadable', reading: IOS_PERMISSION }));
  ok('and a read that went wrong is named ahead of everything',
     line({ threw: true, kept: 'unreadable', reading: IOS_PERMISSION }) === threw);

  // ── Junk ──
  //
  // Nothing absent is still nothing to say. An absence record that exists but
  // holds nothing recognisable reads as the commonest case, which is the one
  // the reader can act on.
  ok('no absence at all says nothing',
     line(undefined) === '' && line(0) === '' && line(null) === '');
  ok('and a half-written one falls to the case anybody can act on',
     line({}) === never && line({ kept: 'ok' }) === never,
     `${line({})} / ${line({ kept: 'ok' })}`);
  // A line is a line, and a throw is not one: both are rendered straight into
  // a Text. The helper above turns either into a sentence that fails here.
  ok('nothing throws and nothing comes back that is not a line',
     [null, undefined, 0, {}, { threw: true }, { kept: 'unreadable' },
      { kept: 'ok', broke: true }, { reading: IOS_PERMISSION }]
       .every(a => !/^(threw|not a string)/.test(line(a))));
}

// ── Which kind of "none coming up" it is ───────────────────────────────────
//
// "375 entries · none coming up" is two quite different calendars wearing one
// sentence: one whose entries have all been and gone, which is the wrong
// calendar, and one whose dates this app cannot read, which is a bug here.
// That sentence was on the screen for days while both of us guessed.
{
  const feed = extra => ({ name: 'TA', events: 375, ahead: 0, ...extra });
  const said = extra => feedSummary(feed(extra), 'read today');

  const past = said({ readable: 375, latest: '2024-03-14T09:00:00.000Z' });
  ok('a calendar whose entries have all been says when the last one was',
     /last one was/.test(past), past);
  ok('and gives the date, which is what says "wrong calendar" at a glance',
     /2024/.test(past), past);

  const unreadable = said({ readable: 0, latest: '' });
  ok('and one whose dates cannot be read says that instead',
     /no dates in it this app can read/.test(unreadable), unreadable);
  ok('which is not the same sentence, because it is not the same fault',
     unreadable !== past, `${unreadable} / ${past}`);

  // Some read and some did not: a third state, and a different bug again from
  // none of them reading.
  const partly = said({ readable: 200, latest: '2025-01-02T09:00:00.000Z' });
  ok('a calendar only partly dated says how much of it',
     /only 200 dated/.test(partly), partly);

  // A record written before any of this existed has no count in it. Saying
  // "no dates this app can read" would be a confident lie about a calendar
  // nobody has measured.
  const older = said({});
  ok('a record from before this was measured asks to be read again',
     /read it again/.test(older), older);
  ok('rather than claiming its dates cannot be read',
     !/cannot read|no dates/.test(older), older);

  // And none of it appears when there is something coming up, because then
  // the question is not being asked.
  const fine = feedSummary(
    feed({ ahead: 7, readable: 375, latest: '2026-11-01T09:00:00.000Z' }), 'read today');
  ok('a calendar with something in it says none of this', !/last one|dated|read it again/.test(fine), fine);
  ok('and still says how much is coming up', /7 coming up/.test(fine), fine);

  // A calendar that yielded nothing at all is already answered by the line
  // above it; adding a second explanation to "nothing was read from it" says
  // the same thing twice.
  const empty = feedSummary({ name: 'TA', events: 0, ahead: 0, readable: 0 }, 'read today');
  ok('a calendar that gave nothing keeps its own one sentence',
     /nothing was read from it/.test(empty) && !/no dates in it/.test(empty), empty);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
