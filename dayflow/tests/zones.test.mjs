// Where a time was set.
//
// A time in this app was always a wall clock: "11:00" meant eleven o'clock
// wherever the phone happened to be standing. Right for taking pills, wrong for
// almost everything a working diary holds — set a call for three in London, fly
// to New York, and at three New York time the reminder arrives, five hours
// after the call.
//
// The arithmetic is the hard part and it is all edge: the offset depends on the
// instant and the instant depends on the offset, the answer moves twice a year
// in each hemisphere, and half the world is not on a whole number of hours.
//
// Run with `npm test`. The device zone is fixed by the runner, and every
// assertion that depends on it says so.
import {
  supported, deviceZone, knownZone, offsetAt, instantOf, clockIn, sameClock, zoneLabel,
} from '../src/services/zones.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const HOUR = 3600000;

ok('this platform can do zone arithmetic', supported() === true,
   'without it everything below falls back to the wall clock');
ok('and knows where it is', deviceZone() === 'Europe/London', deviceZone());

// ── Which zones exist ───────────────────────────────────────────────────────
ok('a real zone is known', knownZone('America/New_York'));
ok('an invented one is not', !knownZone('Middle/Earth'));
ok('and neither is nothing at all', !knownZone('') && !knownZone(null));

// ── How far from UTC ────────────────────────────────────────────────────────
{
  const january = new Date(Date.UTC(2026, 0, 15, 12));
  const july = new Date(Date.UTC(2026, 6, 15, 12));

  ok('London is on UTC in January', offsetAt('Europe/London', january) === 0);
  ok('and an hour ahead in July', offsetAt('Europe/London', july) === HOUR);
  ok('New York is five behind in January',
     offsetAt('America/New_York', january) === -5 * HOUR,
     String(offsetAt('America/New_York', january) / HOUR));
  ok('and four in July', offsetAt('America/New_York', july) === -4 * HOUR);

  // Half the world is not on a whole number of hours, and an implementation
  // that rounds gets India wrong by half an hour all year.
  ok('India is five and a half ahead', offsetAt('Asia/Kolkata', january) === 5.5 * HOUR,
     String(offsetAt('Asia/Kolkata', january) / HOUR));
  ok('and stays there in July', offsetAt('Asia/Kolkata', july) === 5.5 * HOUR);
  // And the southern hemisphere moves the other way.
  ok('Sydney is ahead by eleven in January', offsetAt('Australia/Sydney', january) === 11 * HOUR,
     String(offsetAt('Australia/Sydney', january) / HOUR));
  ok('and ten in July', offsetAt('Australia/Sydney', july) === 10 * HOUR);

  ok('an invented zone has no offset', offsetAt('Middle/Earth', january) === null);
  ok('and neither has a date that is not one', offsetAt('Europe/London', new Date('nope')) === null);
}

// ── A wall clock, turned into a moment ──────────────────────────────────────
{
  const three = instantOf(2026, 10, 2, 15, 0, 'Europe/London');
  ok('three in the afternoon in London, in October, is two o\'clock UTC',
     three.toISOString() === '2026-10-02T14:00:00.000Z', three.toISOString());

  // After the clocks go back on 25 October, the same wall time is a different
  // instant. An implementation that computed the offset once would be an hour
  // out for the rest of the winter.
  const november = instantOf(2026, 11, 2, 15, 0, 'Europe/London');
  ok('and three o\'clock in November is three o\'clock UTC',
     november.toISOString() === '2026-11-02T15:00:00.000Z', november.toISOString());

  ok('nine in New York is two in the afternoon UTC in October',
     instantOf(2026, 10, 2, 9, 0, 'America/New_York').toISOString() === '2026-10-02T13:00:00.000Z',
     instantOf(2026, 10, 2, 9, 0, 'America/New_York').toISOString());
  ok('and half past nine in Kolkata is four in the morning',
     instantOf(2026, 10, 2, 9, 30, 'Asia/Kolkata').toISOString() === '2026-10-02T04:00:00.000Z',
     instantOf(2026, 10, 2, 9, 30, 'Asia/Kolkata').toISOString());

  // The hour that happens twice. Britain's clocks go back at two on 25 October
  // 2026, so half past one comes round again — either answer is defensible and
  // neither may be an hour out.
  const doubled = instantOf(2026, 10, 25, 1, 30, 'Europe/London');
  const seen = clockIn('Europe/London', doubled);
  ok('the hour that happens twice lands on one of the two',
     seen.hour === 1 && seen.minute === 30, JSON.stringify(seen));

  // The hour that never happens. Clocks go forward at one on 29 March 2026, so
  // half past one does not exist; the answer must still be a real instant
  // rather than a crash or a NaN.
  const missing = instantOf(2026, 3, 29, 1, 30, 'Europe/London');
  ok('and the hour that never happens is still a moment',
     missing instanceof Date && !Number.isNaN(missing.getTime()), String(missing));

  // The morning a clock jumps forward, and the reason the correction runs
  // twice. New York's clocks go forward at two on 8 March 2026. Three o'clock
  // that morning, guessed once, lands on the far side of the change and comes
  // back an hour late — and there are 128 wall times a year across the common
  // zones where a single pass gets it wrong, all of them clustered on the
  // mornings people are already confused about.
  ok('three on the morning the clocks go forward is three, not four',
     instantOf(2026, 3, 8, 3, 0, 'America/New_York').toISOString() === '2026-03-08T07:00:00.000Z',
     instantOf(2026, 3, 8, 3, 0, 'America/New_York').toISOString());
  ok('and so is half past two',
     instantOf(2026, 3, 8, 2, 30, 'America/New_York').toISOString() === '2026-03-08T06:30:00.000Z',
     instantOf(2026, 3, 8, 2, 30, 'America/New_York').toISOString());

  ok('an invented zone names no moment', instantOf(2026, 10, 2, 15, 0, 'Middle/Earth') === null);
}

// ── A moment, read somewhere else ───────────────────────────────────────────
{
  const three = instantOf(2026, 10, 2, 15, 0, 'Europe/London');
  ok('three in London is ten in the morning in New York',
     clockIn('America/New_York', three).text === '10:00',
     clockIn('America/New_York', three).text);
  ok('and half past seven in the evening in Kolkata',
     clockIn('Asia/Kolkata', three).text === '19:30',
     clockIn('Asia/Kolkata', three).text);
  ok('and still three in London', clockIn('Europe/London', three).text === '15:00');
  ok('with the day it falls on', clockIn('America/New_York', three).day === 2);

  // Across the date line the day itself changes, which is the case that makes
  // reading a calendar date locally unsafe.
  const late = instantOf(2026, 10, 2, 23, 0, 'Europe/London');
  ok('eleven at night in London is the next morning in Sydney',
     clockIn('Australia/Sydney', late).day === 3,
     JSON.stringify(clockIn('Australia/Sydney', late)));

  ok('an invented zone shows no clock', clockIn('Middle/Earth', three) === null);
}

// ── Whether it is worth mentioning ──────────────────────────────────────────
{
  const at = new Date(Date.UTC(2026, 0, 15, 12));
  ok('the same zone is the same zone', sameClock('Europe/London', 'Europe/London', at));
  // Two names for the same hour. Telling somebody their three o'clock is three
  // o'clock is not information.
  ok('two names for one hour are one hour',
     sameClock('Europe/London', 'Europe/Dublin', at));
  ok('London and New York are not', !sameClock('Europe/London', 'America/New_York', at));
  // In July they differ; in January, Lisbon and London agree.
  ok('and Lisbon agrees with London', sameClock('Europe/London', 'Europe/Lisbon', at));
  ok('nothing said means nothing to say', sameClock('', 'America/New_York', at));
  ok('and an invented zone is not worth a sentence about',
     sameClock('Middle/Earth', 'Europe/London', at));
}

// ── What to call it ─────────────────────────────────────────────────────────
ok('a zone is called by its city', zoneLabel('America/New_York') === 'New York');
ok('underscores are not how anybody writes it', zoneLabel('Asia/Kolkata') === 'Kolkata');
ok('three parts keep the last', zoneLabel('America/Argentina/Buenos_Aires') === 'Buenos Aires',
   zoneLabel('America/Argentina/Buenos_Aires'));
ok('and nothing is nothing', zoneLabel('') === '' && zoneLabel(null) === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
