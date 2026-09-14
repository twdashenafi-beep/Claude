// How long you have been waiting.
//
// Owe Me is a chasing list, and the only question it has to answer before you
// pick up the phone is how long this has been sitting. The risk in saying so is
// saying it too often: a row that reads "waiting 0 days" against everything is
// noise you learn to skip, and once you skip it you skip the fortnight-old one
// beside it too. So most of these checks are about staying quiet.
//
// Run with `npm test`.
import { execFileSync } from 'node:child_process';
import { daysWaiting, waitingLabel } from '../src/services/waiting.js';

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

const label = (task) => waitingLabel(task, NOW);
const text = (task) => (label(task) || {}).text;
const stale = (task) => !!(label(task) || {}).stale;

// ── Silence ──
//
// The first two days are the whole reason this can be on every row without
// becoming wallpaper.
ok('something asked for today says nothing', label(owed(0)) === null);
ok('and yesterday still says nothing', label(owed(1)) === null);
ok('a To Do says nothing — it is not owed by anyone',
   label({ ...owed(30), taskType: 'to_do' }) === null);
ok('nor a task with no type at all',
   label({ createdAt: owed(30).createdAt }) === null);
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
ok('and its count floors at nought', daysWaiting(owed(-5), NOW) === 0);

// ── Speaking ──
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
   daysWaiting({ taskType: 'done_for_me', createdAt: '2026-09-08T23:41:00' },
               new Date('2026-09-09T00:10:00')) === 1);
ok('and two nights ago speaks up',
   text({ taskType: 'done_for_me', createdAt: '2026-09-07T23:41:00' }) === undefined
     ? false
     : waitingLabel({ taskType: 'done_for_me', createdAt: '2026-09-07T23:41:00' },
                    new Date('2026-09-09T00:10:00')).text === 'waiting 2 days');

// ── The clocks going back ──
//
// A 25-hour day divided by 86,400,000 is 1.04 days; a 23-hour day is 0.96. Left
// to truncate, an autumn weekend loses a day off every count that crosses it.
// Rounding from midnight is what keeps this honest, so prove it in the zones
// where the hour actually moves.
{
  const script = `
    import { daysWaiting } from '${new URL('../src/services/waiting.js', import.meta.url).pathname}';
    const [from, to] = process.argv.slice(1);
    process.stdout.write(String(daysWaiting({ taskType: 'done_for_me', createdAt: from },
                                            new Date(to))));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
