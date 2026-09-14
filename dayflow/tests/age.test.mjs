// How long a task has been sitting there.
//
// One question, two columns, opposite meanings: in Owe Me somebody has had it
// for three weeks, in To Do you have carried it for three weeks and not done
// it. The risk in saying either is saying it too often — a row that remarks on
// itself the day after it was made is noise you learn to skip, and once you
// skip it you skip the six-week-old one beside it too. So most of these checks
// are about staying quiet.
//
// Run with `npm test`.
import { execFileSync } from 'node:child_process';
import { daysSince, ageLabel } from '../src/services/age.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// Midday, so a task made in the morning and one made in the evening of the same
// day both land on nought without the arithmetic needing to care.
const NOW = new Date('2026-09-09T12:00:00');

// A task made `days` ago, at a deliberately awkward hour.
const owed = (days, extra = {}) => ({
  taskType: 'done_for_me',
  createdAt: new Date(new Date('2026-09-09T23:41:00').getTime() - days * 86400000).toISOString(),
  ...extra,
});

const label = (task) => ageLabel(task, NOW);
const text = (task) => (label(task) || {}).text;
const stale = (task) => !!(label(task) || {}).stale;

// ── Owe Me: silence ──
//
// The first two days are the whole reason this can be on every row without
// becoming wallpaper.
ok('something asked for today says nothing', label(owed(0)) === null);
ok('and yesterday still says nothing', label(owed(1)) === null);
ok('a To Do says nothing at three days — it is simply a task',
   label({ ...owed(3), taskType: 'todo' }) === null);
ok('a completed chase says nothing — it arrived',
   label(owed(30, { completed: true })) === null);
ok('a task with no createdAt says nothing', label({ taskType: 'done_for_me' }) === null);
ok('an unreadable createdAt says nothing',
   label({ taskType: 'done_for_me', createdAt: 'last Tuesday' }) === null);
ok('nothing at all is silent', label(null) === null);
ok('undefined is silent', label(undefined) === null);

// A clock skewed between two devices can date a task into the future. That is
// worth nothing more than silence — never a negative count.
ok('a task created tomorrow is silent', label(owed(-1)) === null);
ok('and its count floors at nought', daysSince(owed(-5).createdAt, NOW) === 0);

// ── Owe Me: speaking ──
ok('two days is where it starts', text(owed(2)) === 'waiting 2 days');
ok('and it is not yet late', stale(owed(2)) === false);
ok('a week', text(owed(7)) === 'waiting 7 days');
ok('thirteen days is still counted in days', text(owed(13)) === 'waiting 13 days');
ok('and is the last day that is not late', stale(owed(13)) === false);

// ── The fortnight ──
//
// Past this someone is late, and it takes the same red as an overdue task,
// because it means the same thing about a different person.
ok('a fortnight turns late', stale(owed(14)));
ok('and reads in weeks', text(owed(14)) === 'waiting 2 weeks');
ok('so does everything past it', stale(owed(90)));

// ── Units ──
ok('a month reads in weeks', text(owed(30)) === 'waiting 4 weeks');
ok('two months reads in months', text(owed(60)) === 'waiting 2 months');
ok('half a year', text(owed(180)) === 'waiting 6 months');
ok('a year gives up counting', text(owed(365)) === 'waiting over a year');
ok('and stays given up', text(owed(900)) === 'waiting over a year');

// The thresholds exist so no unit ever has to say "1" — thirteen days becomes
// two weeks, not one week — which keeps singular and plural out of the wording
// entirely. Sweep the whole range rather than trust the three boundaries.
{
  let bad = null;
  for (let d = 2; d <= 800 && !bad; d++) {
    const t = text(owed(d));
    if (!t) { bad = `${d} days said nothing`; break; }
    if (/ 1 (day|week|month)/.test(t)) bad = `${d} days → "${t}"`;
    if (/\bday\b|\bweek\b|\bmonth\b/.test(t)) bad = `${d} days → "${t}" (singular)`;
  }
  ok('no count anywhere reads "1", so nothing is ever singular', bad === null, bad || '');
}

// Every day from two to a year rounds to something, and the wording never
// disagrees with the red.
{
  let bad = null;
  for (let d = 2; d <= 800 && !bad; d++) {
    const l = label(owed(d));
    if (l.stale !== (d >= 14)) bad = `${d} days: stale=${l.stale}`;
  }
  ok('late begins at the fortnight and never goes back', bad === null, bad || '');
}

// ── Days are days, not 24-hour blocks ──
//
// A task asked for at 23:41 and read at 00:10 the next morning has been waiting
// one day, not nought. Counting from midnight to midnight is what makes that
// true — and it is also what survives the hour that clocks give back.
ok('late last night reads as a day by morning',
   daysSince('2026-09-08T23:41:00', new Date('2026-09-09T00:10:00')) === 1);
ok('and two nights ago speaks up',
   (ageLabel({ taskType: 'done_for_me', createdAt: '2026-09-07T23:41:00' },
             new Date('2026-09-09T00:10:00')) || {}).text === 'waiting 2 days');

// ── The clocks going back ──
//
// A 25-hour day divided by 86,400,000 is 1.04 days; a 23-hour day is 0.96. Left
// to truncate, an autumn weekend loses a day off every count that crosses it.
// Rounding from midnight is what keeps this honest, so prove it in the zones
// where the hour actually moves.
{
  const script = `
    import { daysSince } from '${new URL('../src/services/age.js', import.meta.url).pathname}';
    const [from, to] = process.argv.slice(1);
    process.stdout.write(String(daysSince(from, new Date(to))));
  `;
  const spans = [
    // London: clocks back 25 Oct 2026, forward 29 Mar 2026.
    ['Europe/London', '2026-10-20T09:00:00', '2026-10-27T09:00:00', 7, 'the hour given back'],
    ['Europe/London', '2026-03-26T09:00:00', '2026-04-02T09:00:00', 7, 'the hour taken'],
    // New York: back 1 Nov 2026, forward 8 Mar 2026.
    ['America/New_York', '2026-10-28T09:00:00', '2026-11-04T09:00:00', 7, 'the hour given back'],
    ['America/New_York', '2026-03-05T09:00:00', '2026-03-12T09:00:00', 7, 'the hour taken'],
    // Southern hemisphere, so the seasons are the other way round.
    ['Australia/Sydney', '2026-03-31T09:00:00', '2026-04-07T09:00:00', 7, 'the hour given back'],
    ['Australia/Sydney', '2026-09-29T09:00:00', '2026-10-06T09:00:00', 7, 'the hour taken'],
    // A zone that has never moved its clocks, as a control.
    ['UTC', '2026-10-20T09:00:00', '2026-10-27T09:00:00', 7, 'no clock change'],
    // A fortnight spanning the change, which is the threshold that matters.
    ['Europe/London', '2026-10-18T09:00:00', '2026-11-01T09:00:00', 14, 'a fortnight across it'],
  ];
  for (const [tz, from, to, want, what] of spans) {
    let got;
    try {
      got = execFileSync(process.execPath, ['--input-type=module', '-e', script, from, to],
        { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim();
    } catch (e) {
      ok(`${tz}: ${what}`, false, String(e.message).slice(0, 160));
      continue;
    }
    ok(`${tz}: ${what} still counts ${want}`, got === String(want), got);
  }
}

// ── To Do: what you have been carrying ──
//
// The same machinery, pointed at the other column and told to keep quiet for far
// longer. Two days is the right moment to mention a chase and entirely the wrong
// moment to mention a task.
const kept = (days, scope = 'day', extra = {}) => ({
  taskType: 'todo',
  viewScope: scope,
  createdAt: new Date(new Date('2026-09-09T23:41:00').getTime() - days * 86400000).toISOString(),
  ...extra,
});

ok('a task made today says nothing', label(kept(0)) === null);
ok('nor after a few days', label(kept(3)) === null);
ok('nor after a week and a half', label(kept(10)) === null);
ok('a fortnight on today\'s list is where it speaks', text(kept(14)) === 'carried 2 weeks');
ok('and it keeps counting', text(kept(40)) === 'carried 6 weeks');
ok('a completed one says nothing', label(kept(90, 'day', { completed: true })) === null);

// ── The scope you filed it under sets the clock ──
//
// This is the app knowing how long you meant something to take. Without it the
// list would call a task avoided three weeks into the month you gave it.
ok('three weeks is avoidance on a day task', text(kept(21, 'day')) === 'carried 3 weeks');
ok('but unremarkable on a week task', label(kept(21, 'week')) === null);
ok('and on a month task', label(kept(21, 'month')) === null);
ok('a week task speaks at a month', text(kept(30, 'week')) === 'carried 4 weeks');
ok('a month task holds out for a quarter', label(kept(89, 'month')) === null);
ok('and then speaks', text(kept(90, 'month')) === 'carried 3 months');

// A task with no scope, or a scope from some future version, is treated as
// today's — the strictest of the three, and the one every task starts in.
ok('no scope is treated as a day task',
   text({ taskType: 'todo', createdAt: kept(14).createdAt }) === 'carried 2 weeks');
ok('and so is a scope this version has never heard of',
   text(kept(14, 'fortnight')) === 'carried 2 weeks');

// ── It never raises its voice ──
//
// Red on this page means somebody is late. Your own backlog is not that, and
// painting it red would colour the whole sheet for the one person it would help
// least.
{
  let loud = null;
  for (let d = 14; d <= 900 && !loud; d++) {
    if (label(kept(d)).stale) loud = `${d} days`;
  }
  ok('nothing you are carrying is ever marked late', loud === null, loud || '');
}

// ── One voice ──
//
// The two columns share the wording so the page does not have two ways of
// saying three weeks.
{
  let odd = null;
  for (let d = 14; d <= 900 && !odd; d++) {
    const chased = text(owed(d)).replace(/^waiting /, '');
    const carried = text(kept(d)).replace(/^carried /, '');
    if (chased !== carried) odd = `${d} days: "${chased}" vs "${carried}"`;
  }
  ok('both columns say a length of time the same way', odd === null, odd || '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
