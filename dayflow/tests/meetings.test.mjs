// Which meeting a task is for.
//
// The link is by title and start time rather than by the calendar's own id,
// because ids do not survive a re-import and a link that quietly comes apart
// every time the diary is refreshed is worse than no link. Most of this suite
// is about what that choice costs and what it buys.
//
// Run under a fixed zone: the identity of a meeting is a minute on a clock.
import {
  keyOfEvent, keyOfTask, meetingOf, attachTo, detach, tasksFor,
  meetingLabel, meetingNote, choices, stillThere,
} from '../src/services/meetings.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const on = (d, hh, mm = 0) => new Date(2026, 9, d, hh, mm);
const ev = (title, start, end, extra = {}) => ({
  id: `${title}-${start.toISOString()}`, title, start, end, allDay: false, ...extra,
});
const NOW = new Date('2026-10-02T09:00:00');

const BOARD = ev('Board call', on(2, 11), on(2, 12, 30));
const STANDUP = ev('Standup', on(2, 9, 30), on(2, 9, 45));
const OFFSITE = { id: 'off', title: 'Offsite', start: on(2, 0), end: on(3, 0), allDay: true };

// ── Naming a meeting ────────────────────────────────────────────────────────
{
  ok('an event has a key', !!keyOfEvent(BOARD));
  ok('and it is the same one each time', keyOfEvent(BOARD) === keyOfEvent({ ...BOARD, id: 'different' }),
     'an id must not be part of it');
  ok('two meetings at the same hour are told apart by name',
     keyOfEvent(BOARD) !== keyOfEvent(ev('Other call', on(2, 11), on(2, 12))));
  ok('and the same name at two hours is two meetings',
     keyOfEvent(BOARD) !== keyOfEvent(ev('Board call', on(2, 14), on(2, 15))));
  ok('capitals and stray spaces are not a different meeting',
     keyOfEvent(BOARD) === keyOfEvent(ev('  BOARD CALL ', on(2, 11), on(2, 12, 30))));
  ok('seconds are not part of a meeting',
     keyOfEvent(BOARD) === keyOfEvent(ev('Board call', new Date(2026, 9, 2, 11, 0, 44), on(2, 12, 30))));
  ok('an all-day event is not something to prepare for at an hour',
     keyOfEvent(OFFSITE) === null);
  ok('and nothing at all has no key', keyOfEvent(null) === null);
}

// ── Attaching and letting go ────────────────────────────────────────────────
{
  const fields = attachTo(BOARD);
  ok('attaching gives the fields to save', !!fields.meeting);
  ok('with the name', fields.meeting.title === 'Board call', fields.meeting.title);
  ok('and the minute', fields.meeting.at.endsWith(':00.000Z') || /T\d\d:\d\d:00/.test(fields.meeting.at),
     fields.meeting.at);

  const task = { id: 't', title: 'Bring the pack', ...fields };
  ok('a task knows what it is for', meetingOf(task).title === 'Board call');
  ok('and matches the event it came from', keyOfTask(task) === keyOfEvent(BOARD));

  ok('letting go clears it', detach.meeting === null);
  ok('attaching to nothing clears it too', attachTo(null).meeting === null);
  ok('and so does attaching to an all-day event', attachTo(OFFSITE).meeting === null);

  ok('a task with no meeting says so', meetingOf({ id: 'x' }) === null);
  ok('junk in the field is not a meeting', meetingOf({ meeting: 'the board call' }) === null);
  ok('nor is half of one', meetingOf({ meeting: { title: 'Board call' } }) === null);
  ok('nor a date that cannot be read',
     meetingOf({ meeting: { title: 'Board call', at: 'elevenish' } }) === null);
}

// ── Everything for one meeting ──────────────────────────────────────────────
{
  const forBoard = (id, title, extra = {}) => ({
    id, title, createdAt: `2026-09-2${id.length}T09:00:00.000Z`,
    ...attachTo(BOARD), ...extra,
  });
  const tasks = [
    forBoard('a', 'Bring the pack'),
    forBoard('bb', 'Read the auditors letter'),
    { id: 'c', title: 'Unrelated', createdAt: '2026-09-21T09:00:00.000Z' },
    { id: 'd', title: 'For the standup', createdAt: '2026-09-21T09:00:00.000Z', ...attachTo(STANDUP) },
    forBoard('eee', 'Filed away', { archivedAt: '2026-09-30T09:00:00.000Z' }),
  ];

  const found = tasksFor(tasks, BOARD);
  ok('the meeting gathers its own', found.length === 2, found.map(t => t.title).join(', '));
  ok('in the order they were made', found[0].id === 'a', found.map(t => t.id).join(''));
  ok('and nothing belonging to another meeting',
     !found.some(t => t.title === 'For the standup'));
  ok('nor anything belonging to none', !found.some(t => t.title === 'Unrelated'));
  ok('an archived one is not brought to the meeting',
     !found.some(t => t.title === 'Filed away'));
  ok('the other meeting gets its own', tasksFor(tasks, STANDUP).length === 1);
  ok('a meeting nobody prepared for gathers nothing',
     tasksFor(tasks, ev('Lunch', on(2, 13), on(2, 14))).length === 0);
  ok('and an all-day event gathers nothing at all', tasksFor(tasks, OFFSITE).length === 0);
}

// ── Saying it ───────────────────────────────────────────────────────────────
{
  const task = { id: 't', title: 'Bring the pack', ...attachTo(BOARD) };
  ok('the row says what it is for', meetingLabel(task) === 'for Board call', meetingLabel(task));
  ok('a finished one says nothing — it is no longer a thing to bring',
     meetingLabel({ ...task, completed: true }) === null);
  ok('nor does a filed one', meetingLabel({ ...task, archivedAt: '2026-10-01T09:00:00.000Z' }) === null);
  ok('and neither does a task for no meeting', meetingLabel({ id: 'x' }) === null);
}

{
  const done = { id: 'a', title: 'A', completed: true };
  const open = { id: 'b', title: 'B' };
  ok('nothing attached, nothing said', meetingNote([]) === null);
  ok('and nothing at all is survived', meetingNote(null) === null);
  ok('one still to do', meetingNote([open]) === '1 thing, 1 still to do', meetingNote([open]));
  ok('one done reads as done', meetingNote([done]) === '1 thing, done', meetingNote([done]));
  ok('some of each', meetingNote([done, open, open]) === '3 things, 2 still to do',
     meetingNote([done, open, open]));
  ok('all of them done', meetingNote([done, done]) === '2 things, all done',
     meetingNote([done, done]));
}

// ── What there is to choose from ────────────────────────────────────────────
{
  const events = [
    STANDUP,
    BOARD,
    OFFSITE,
    ev('Tomorrow call', on(3, 10), on(3, 11)),
    ev('Next week', on(9, 10), on(9, 11)),
    ev('Too far off', on(20, 10), on(20, 11)),
  ];

  const today = choices(events, on(2, 0).toISOString(), NOW);
  ok('a dated task is offered its own day', today.length === 2, today.map(e => e.title).join(', '));
  ok('earliest first', today[0].title === 'Standup', today.map(e => e.title).join(', '));
  ok('and never an all-day one', !today.some(e => e.allDay));

  const tomorrow = choices(events, on(3, 0).toISOString(), NOW);
  ok('a task dated tomorrow is offered tomorrow',
     tomorrow.length === 1 && tomorrow[0].title === 'Tomorrow call',
     tomorrow.map(e => e.title).join(', '));

  // A day with nothing on it falls back to the week rather than offering an
  // empty list, which would read as "there are no meetings" rather than "there
  // are none that day".
  const quiet = choices(events, on(5, 0).toISOString(), NOW);
  ok('a day with no meetings falls back to what is ahead', quiet.length === 4,
     quiet.map(e => e.title).join(', '));

  const undated = choices(events, null, NOW);
  ok('an undated task is offered the fortnight', undated.length === 4,
     undated.map(e => e.title).join(', '));
  // A week today is exactly where people schedule, and a window that stopped an
  // hour short of it would be maddening.
  ok('including a week today', undated.some(e => e.title === 'Next week'),
     undated.map(e => e.title).join(', '));
  ok('but not a month off', !undated.some(e => e.title === 'Too far off'));
  ok('no diary, nothing to choose', choices(null, null, NOW).length === 0);
}

// ── Whether it is still in the diary ────────────────────────────────────────
{
  const task = { id: 't', title: 'Bring the pack', ...attachTo(BOARD) };
  ok('a meeting that is still there is still there', stillThere(task, [STANDUP, BOARD]));
  ok('one that has been moved or cancelled is not', !stillThere(task, [STANDUP]));
  ok('a task for no meeting is never missing one', stillThere({ id: 'x' }, []));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
