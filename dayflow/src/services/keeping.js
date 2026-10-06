import { daysSince, span } from './age.js';

// Whether there is a copy of any of this anywhere else.
//
// The vault is encrypted with a key derived from a password nothing can
// recover. That is the point of it, and it is also the whole risk: delete the
// app and the tasks go with it. That has already happened once to the person
// this was written for, and the app said nothing beforehand because it had
// nothing to say — it recorded when a copy was taken, which is to say never.
//
// So it records it now, and says one line about it. The line is deliberately
// hard to earn: a page that warns about backups every morning is a page people
// learn to read past, and then it is not a warning, it is furniture.
//
// Pure: no clock of its own and no storage. `now` and the copy that was found
// are passed in, which is what makes the awkward parts testable — a half-written
// record from a crash mid-save, a count that went backwards, a device whose
// clock disagrees. The disk is in copyStore.js.

// Below this there is nothing much to lose, and a warning about losing it is
// noise on a day somebody has just started using the app.
const FEW = 5;
// A fortnight without a copy, or this many things written since the last one.
// Two ways to earn the line because they are different kinds of risk: one is
// time passing, the other is a week where everything happened at once.
const OLD_DAYS = 14;
const MISSED = 10;

// How many of the things here are not in the last copy.
//
// Counted rather than timed, because "eleven days ago" says how long you have
// been lucky and this says what the luck is worth. A copy taken before
// twenty-three of your forty-one tasks existed is not much of a copy.
export function missedBy(copy, count) {
  const now = Math.max(0, Number(count) || 0);
  if (!copy) return now;
  return Math.max(0, now - (Number(copy.count) || 0));
}

// The line the Day page shows, or nothing — which is most of the time.
//
// Silent while sync is working, and that is not a shortcut. The risk being
// described is "this is the only copy"; with sync up there are two, and a
// warning that ignores the thing already protecting you is a warning that
// teaches people to ignore it back.
export function keptLine({ copy, count = 0, synced = false, now = new Date() } = {}) {
  if (synced) return null;

  const have = Math.max(0, Number(count) || 0);
  if (have < FEW) return null;

  if (!copy) return 'Nothing here has been copied off this phone';

  const days = daysSince(copy.at, now);
  if (days === null) return 'Nothing here has been copied off this phone';

  const missed = missedBy(copy, have);
  if (days < OLD_DAYS && missed < MISSED) return null;

  const when = `Last copy ${days === 0 ? 'today' : span(days) + ' ago'}`;
  return missed > 0 ? `${when} — ${missed} of these were written since` : when;
}

// The factual one, said beside the control that takes a copy. Always, because
// somebody standing in front of the Export button is asking this exact
// question, and "nothing is known" is an answer to it.
export function keptNote(copy, count = 0, now = new Date()) {
  if (!copy) return 'No copy has been taken on this phone.';
  const days = daysSince(copy.at, now);
  if (days === null) return 'No copy has been taken on this phone.';
  const missed = missedBy(copy, count);
  const when = days === 0 ? 'today' : `${span(days)} ago`;
  const held = `${copy.count} ${copy.count === 1 ? 'thing' : 'things'} in it`;
  return missed > 0
    ? `Last copy ${when} · ${held}, ${missed} written since.`
    : `Last copy ${when} · ${held}.`;
}
