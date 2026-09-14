// When a task is due, and whether it is late.
//
// The trap this has to avoid is the reason the app said nothing before. Every
// task carries a dueDate whether or not anyone chose one — a task made with no
// date is stamped with the moment it was made — so a naive "is dueDate in the
// past" marks half the list overdue by Thursday. A date only counts as meant
// when it says something the default could not have said.
//
// Run with `npm test`.
import { dueLabel, dueSpoken, dueMoment, calendarWindow } from '../src/services/due.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// A Wednesday afternoon, so "tomorrow" and "this week" are unambiguous.
const NOW = new Date('2026-09-09T14:00:00');
const label = (task) => dueLabel(task, NOW);
const text = (task) => (label(task) || {}).text;
const late = (task) => !!(label(task) || {}).late;

const on = (day, time = '', extra = {}) => ({ dueDate: `${day}T10:00:00`, dueTime: time, ...extra });

// ── The default stamp says nothing ──
//
// This is the whole reason the rule is not "is it in the past".
ok('a task dated today with no time is silent', label(on('2026-09-09')) === null);
ok('and one made this morning is not called overdue',
   label({ dueDate: '2026-09-09T08:00:00', dueTime: '' }) === null);
ok('a task with no date at all is silent', label({ title: 'x' }) === null);
ok('a task with an unreadable date is silent', label({ dueDate: 'not a date' }) === null);
ok('nothing at all is silent', label(null) === null);
ok('undefined is silent', label(undefined) === null);

// ── The stamp is still the stamp a week later ──
//
// This is the case the "is it today" rule could not see. `dueDate` falls back
// to `createdAt`, to the millisecond, so an undated task carries a date in the
// past from the morning after it was made — and every one of them read
// "Overdue" until the two fields were compared to each other.
const MADE = '2026-09-02T16:22:41.318Z';
const undated = (extra = {}) => ({ createdAt: MADE, dueDate: MADE, dueTime: '', ...extra });

ok('an undated task made a week ago still says nothing', label(undated()) === null);
ok('nor one made a year ago',
   label({ createdAt: '2025-04-01T09:00:00.000Z', dueDate: '2025-04-01T09:00:00.000Z' }) === null);
ok('and it is not called late', late(undated()) === false);

// The stamp is only the stamp while nobody has touched it. A time on the same
// date is a deadline, because nothing sets a time by accident.
ok('a time on the stamped date is a real deadline',
   text(undated({ dueTime: '09:00' })) === 'Overdue');
ok('and a date that differs from when it was made is one too',
   text({ createdAt: MADE, dueDate: '2026-09-04T10:00:00', dueTime: '' }) === 'Overdue');
ok('including a future one',
   text({ createdAt: MADE, dueDate: '2026-09-10T10:00:00', dueTime: '' }) === 'Tomorrow');

// ── Dates invented by older versions ──
//
// Before this, adding a task stamped it with the moment the screen had been
// opened — hours earlier in a long session, and never equal to createdAt. Those
// tasks are sitting in vaults now, so the stamp has to be recognisable when it
// is a little before the task was made and on the same day as it.
ok('a date from when the screen was opened is not a deadline',
   label({ createdAt: '2026-09-02T16:22:41.318Z', dueDate: '2026-09-02T13:04:02.771Z' }) === null);
ok('nor one a millisecond earlier',
   label({ createdAt: '2026-09-02T16:22:41.318Z', dueDate: '2026-09-02T16:22:41.317Z' }) === null);

// What it must not swallow is a date somebody chose, and the ordinary way to
// choose one in the past is to pick a day that is not the day you are on.
ok('but last month with no time is still a deadline',
   text({ createdAt: '2026-09-02T16:22:41.318Z', dueDate: '2026-08-15T00:00:00' }) === 'Overdue');
ok('and so is yesterday',
   text({ createdAt: '2026-09-02T16:22:41.318Z', dueDate: '2026-09-01T00:00:00' }) === 'Overdue');
ok('and a time on the day it was made is one',
   text({ createdAt: '2026-09-09T16:22:41.318Z', dueDate: '2026-09-09T13:04:02.771Z',
          dueTime: '13:04' }) === 'Overdue');

// A date after the task was made is always something chosen — nothing defaults
// forwards.
ok('a date later the same day is a deadline',
   text({ createdAt: '2026-09-09T06:00:00', dueDate: '2026-09-09T06:00:01', dueTime: '17:30' })
     === '17:30');

// A task from before createdAt could be relied upon has only the old rule to
// fall back on, and must not start throwing.
ok('a task with a date but no createdAt still follows the old rule',
   label({ dueDate: '2026-09-09T10:00:00', dueTime: '' }) === null);
ok('an unreadable createdAt does not make the date vanish',
   text({ createdAt: 'whenever', dueDate: '2026-09-08T10:00:00' }) === 'Overdue');

// ── Late ──
ok('a time earlier today is overdue', text(on('2026-09-09', '09:00')) === 'Overdue');
ok('and it is marked late', late(on('2026-09-09', '09:00')));
ok('yesterday is overdue', text(on('2026-09-08')) === 'Overdue');
ok('last month is overdue', text(on('2026-08-19', '09:00')) === 'Overdue');
ok('overdue says one word and no more', text(on('2026-06-01', '09:00')) === 'Overdue');

// ── Not late ──
ok('later today is just the time', text(on('2026-09-09', '17:30')) === '17:30');
ok('and is not marked late', late(on('2026-09-09', '17:30')) === false);
ok('tomorrow says tomorrow', text(on('2026-09-10')) === 'Tomorrow');
ok('tomorrow with a time carries it', text(on('2026-09-10', '11:00')) === 'Tomorrow 11:00');
ok('later this week is the day name', text(on('2026-09-11')) === 'Fri');
ok('with its time', text(on('2026-09-11', '08:15')) === 'Fri 08:15');
ok('a week out is a date', text(on('2026-09-16', '')) === '16 Sep');
ok('and further still', text(on('2026-10-14', '09:30')) === '14 Oct 09:30');

// ── Finished work is not late ──
ok('a completed overdue task says nothing',
   label(on('2026-08-19', '09:00', { completed: true })) === null);
ok('nor a completed one due tomorrow',
   label(on('2026-09-10', '11:00', { completed: true })) === null);

// ── The boundary between today and overdue is the minute, not the day ──
ok('a minute before now is overdue', text(on('2026-09-09', '13:59')) === 'Overdue');
ok('a minute after now is not', text(on('2026-09-09', '14:01')) === '14:01');

// ── Nonsense times do not throw or lie ──
for (const bad of ['99:99', '9:0', 'noon', '', null, undefined, 12]) {
  const t = { dueDate: '2026-09-11T10:00:00', dueTime: bad };
  let threw = false;
  try { dueLabel(t, NOW); } catch { threw = true; }
  ok(`a dueTime of ${JSON.stringify(bad)} is survived`, !threw);
}
ok('an impossible time falls back to the date alone',
   text({ dueDate: '2026-09-11T10:00:00', dueTime: '99:99' }) === 'Fri');

// ── What a screen reader is told ──
ok('overdue is spoken as overdue', dueSpoken(on('2026-09-08'), NOW) === 'overdue');
ok('and a date is spoken as due', dueSpoken(on('2026-09-10'), NOW) === 'due Tomorrow');
ok('and silence stays silent', dueSpoken(on('2026-09-09'), NOW) === null);

// ── The clock is passed in, so this is not a test that fails at midnight ──
{
  const midnight = new Date('2026-09-09T00:00:00');
  ok('at one minute past midnight, nine in the morning is still ahead',
     dueLabel(on('2026-09-09', '09:00'), midnight).text === '09:00');
  const lateNight = new Date('2026-09-09T23:59:00');
  ok('and at the end of the day it is behind',
     dueLabel(on('2026-09-09', '09:00'), lateNight).text === 'Overdue');
}

// ── Days are not always 86400 seconds ──
//
// "Today", "tomorrow" and "overdue" are decided by counting days between two
// local midnights. Twice a year that gap is 23 hours or 25, and on the far side
// of the world it is a different calendar day from UTC at the same instant. An
// off-by-one here would surface as tasks quietly reading Overdue on the morning
// the clocks change — so the cases are run for real, in four zones, rather than
// reasoned about.
//
// Each runs in its own process because TZ is read once per Date operation and
// this test's own clock must not move under it.
{
  const { execFileSync } = await import('node:child_process');
  const here = new URL('.', import.meta.url).pathname;

  const script = `
    import { dueLabel } from '${here}../src/services/due.js';
    const ymd = d => d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const out = [];
    for (const iso of process.argv.slice(1)) {
      const now = new Date(iso);
      const task = day => ({ dueDate: day + 'T12:00:00', dueTime: '' });
      const text = t => { const r = dueLabel(t, now); return r ? r.text : 'SILENT'; };
      out.push([
        text({ dueDate: ymd(now) + 'T00:00:00', dueTime: '18:00' }),
        text(task(ymd(new Date(now.getTime() + 86400000)))),
        text(task(ymd(new Date(now.getTime() - 86400000)))),
      ].join('|'));
    }
    console.log(out.join(String.fromCharCode(10)));
  `;

  // Clocks back in London on 25 Oct 2026, forward on 29 Mar; a new year; and an
  // ordinary day for a control.
  const DAYS = ['2026-10-25T10:00:00', '2026-03-29T10:00:00', '2027-01-01T10:00:00', '2026-06-15T10:00:00'];

  for (const tz of ['Europe/London', 'America/New_York', 'Australia/Sydney', 'UTC', 'Pacific/Kiritimati']) {
    let lines;
    try {
      lines = execFileSync(process.execPath, ['--input-type=module', '-e', script, ...DAYS],
        { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim().split('\n');
    } catch (e) {
      ok(`${tz}: the probe runs`, false, String(e.message).slice(0, 120));
      continue;
    }
    lines.forEach((line, i) => {
      const [today, tomorrow, past] = line.split('|');
      const when = DAYS[i].slice(0, 10);
      ok(`${tz} ${when}: this evening reads as a time`, /^\d{2}:\d{2}$/.test(today), today);
      ok(`${tz} ${when}: tomorrow reads Tomorrow`, tomorrow === 'Tomorrow', tomorrow);
      ok(`${tz} ${when}: yesterday reads Overdue`, past === 'Overdue', past);
    });
  }
}

// ── Handing a task to the device's calendar ──
//
// This read the date field on its own, which does not carry the time — the app
// keeps the two apart and combines them everywhere else. So a task due at half
// past five was filed at midnight: right day, emphatically wrong hour. And
// since every task carries a dueDate whether or not anybody picked one, it
// would also cheerfully file an undated task at the second it was created.
{
  const at = (task) => {
    const w = calendarWindow(task);
    return w ? w.startDate : null;
  };
  const hhmm = (d) => d && `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const mins = (w) => w && Math.round((w.endDate - w.startDate) / 60000);

  // Nothing anybody chose does not go in a calendar.
  ok('an undated task has no moment', dueMoment(undated()) === null);
  ok('and nothing to put in a calendar', calendarWindow(undated()) === null);
  ok('nor does one dated by an older version',
     calendarWindow({ createdAt: '2026-09-02T16:22:41.318Z',
                      dueDate: '2026-09-02T13:04:02.771Z' }) === null);
  ok('nor one with no date at all', calendarWindow({ title: 'x' }) === null);
  ok('nor one whose date cannot be read', calendarWindow({ dueDate: 'whenever' }) === null);
  ok('and nothing at all is safe', calendarWindow(null) === null);

  // The bug itself: a chosen time has to survive into the event.
  const evening = { createdAt: MADE, dueDate: '2026-09-11T00:00:00', dueTime: '17:30' };
  ok('a task due at half past five starts at half past five', hhmm(at(evening)) === '17:30', hhmm(at(evening)));
  ok('on the day it was given', at(evening).getDate() === 11, String(at(evening)));
  ok('and it is an appointment, not a day', calendarWindow(evening).allDay === false);
  ok('lasting an hour', mins(calendarWindow(evening)) === 60, String(mins(calendarWindow(evening))));
  ok('and the moment says it was timed', dueMoment(evening).timed === true);

  // A date carried on a stamp that happens to have a time of day in it must not
  // become an event at that arbitrary hour.
  const friday = { createdAt: MADE, dueDate: '2026-09-11T10:00:00', dueTime: '' };
  ok('a day with no time starts at midnight', hhmm(at(friday)) === '00:00', hhmm(at(friday)));
  ok('and is a whole day', calendarWindow(friday).allDay === true);
  ok('lasting one', mins(calendarWindow(friday)) === 1440, String(mins(calendarWindow(friday))));
  ok('and the moment says it was not timed', dueMoment(friday).timed === false);

  // Midnight is a legitimate time to choose, and must not be mistaken for none.
  const midnight = { createdAt: MADE, dueDate: '2026-09-11T00:00:00', dueTime: '00:00' };
  ok('a task chosen for midnight is still an appointment',
     calendarWindow(midnight).allDay === false);
  ok('lasting an hour, not a day', mins(calendarWindow(midnight)) === 60);

  // A time that is not a time is not one.
  ok('a nonsense time falls back to the whole day',
     calendarWindow({ createdAt: MADE, dueDate: '2026-09-11T10:00:00', dueTime: '99:99' }).allDay === true);

  // Finishing something does not change when it was due. A label stays quiet
  // about a finished task because it should not shout; a moment is a fact.
  ok('a finished task still has a moment',
     calendarWindow({ ...evening, completed: true }) !== null);
  ok('while its label stays quiet', dueLabel({ ...evening, completed: true }, NOW) === null);

  // A whole day is a day, not 86,400,000 milliseconds. Twice a year those are
  // different numbers, and the difference puts the end of an all-day event an
  // hour inside the day before or the day after.
  {
    const { execFileSync } = await import('node:child_process');
    const script = `
      import { calendarWindow } from '${new URL('../src/services/due.js', import.meta.url).pathname}';
      const w = calendarWindow({ createdAt: '2020-01-01T00:00:00',
                                 dueDate: process.argv[1], dueTime: '' });
      const pad = n => String(n).padStart(2, '0');
      const show = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      process.stdout.write(show(w.startDate) + '|' + show(w.endDate));
    `;
    const days = [
      ['Europe/London', '2026-10-25T12:00:00', '2026-10-25 00:00|2026-10-26 00:00', 'the 25-hour day'],
      ['Europe/London', '2026-03-29T12:00:00', '2026-03-29 00:00|2026-03-30 00:00', 'the 23-hour day'],
      ['America/New_York', '2026-11-01T12:00:00', '2026-11-01 00:00|2026-11-02 00:00', 'the 25-hour day'],
      ['Australia/Sydney', '2026-10-04T12:00:00', '2026-10-04 00:00|2026-10-05 00:00', 'the 23-hour day'],
      ['UTC', '2026-10-25T12:00:00', '2026-10-25 00:00|2026-10-26 00:00', 'an ordinary day'],
    ];
    for (const [tz, iso, want, what] of days) {
      let got;
      try {
        got = execFileSync(process.execPath, ['--input-type=module', '-e', script, iso],
          { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim();
      } catch (e) {
        ok(`${tz}: ${what}`, false, String(e.message).slice(0, 160));
        continue;
      }
      ok(`${tz}: an all-day event spans ${what} exactly`, got === want, got);
    }
  }

  // The end is always after the start, whatever was asked for.
  let backwards = null;
  for (const t of [evening, friday, midnight]) {
    const w = calendarWindow(t);
    if (!(w.endDate > w.startDate)) backwards = JSON.stringify(w);
  }
  ok('an event never ends before it starts', backwards === null, backwards || '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
