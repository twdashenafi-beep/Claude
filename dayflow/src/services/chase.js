// Asking for the thing back.
//
// Owe Me knows who owes you what and how long it has been. It has never once
// helped you ask. The column counts "waiting on 2 items · 2 people" and then
// leaves the actual chasing — the part that takes the time — entirely to you.
//
// And chasing is not done a task at a time. If the letting agent owes you the
// inventory and the meter reading, that is one message, not two, and anybody
// who sends two looks like they cannot keep track of their own paperwork. Yet
// the app files those as separate rows and says nothing about their being the
// same phone call.
//
// So a chase is written per person rather than per task: everything they owe,
// in one message, oldest first, with how long each has been waiting. It is a
// draft rather than a send — it goes to the share sheet, where you edit it and
// choose who gets it.
//
// Pure: no clipboard, no network, no model. The app already had every word of
// this; it simply never put them in an order you could send.

import { daysSince, span } from './age.js';

// Everything one person still owes, oldest first. Completed and archived tasks
// are not owed any more, whatever the column says.
export function owedBy(tasks, person) {
  const name = String(person || '').trim().toLowerCase();
  if (!name) return [];

  return (tasks || [])
    .filter(t => t
      && t.taskType === 'done_for_me'
      && !t.completed
      && !t.archivedAt
      && String(t.owePerson || '').trim().toLowerCase() === name
      && String(t.title || '').trim())
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

// Everything one person is on the hook for, finished or not, oldest first.
//
// Not the same question as owedBy, and deliberately so. A chase is about what
// is outstanding; a person view is about the person. Somebody who sent the
// meter reading last week is still somebody you have two things with, and
// gating the view on what is outstanding right now would make it disappear the
// moment one of them arrived — which is precisely when you want to look at the
// rest of what is open with them.
export function historyWith(tasks, person) {
  const name = String(person || '').trim().toLowerCase();
  if (!name) return [];

  return (tasks || [])
    .filter(t => t
      && t.taskType === 'done_for_me'
      && String(t.owePerson || '').trim().toLowerCase() === name
      && String(t.title || '').trim())
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

// How long ago it was asked for, in the same words the row uses, or '' when the
// task does not say when it was made.
function whenAsked(task, now) {
  const days = daysSince(task.createdAt, now);
  if (days === null) return '';
  if (days === 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  return `${span(days)} ago`;
}

// The message, or null when there is nothing to ask for.
//
// Deliberately plain. It goes out under your name, so it says the minimum a
// person needs in order to answer and then gets out of the way — no pressure,
// no apology, nothing anybody would be embarrassed to have sent.
export function chaseMessage(tasks, person, now = new Date()) {
  const owed = owedBy(tasks, person);
  if (owed.length === 0) return null;

  const name = String(person).trim();
  const opening = `Hi ${name} — could you let me know where`;

  if (owed.length === 1) {
    const when = whenAsked(owed[0], now);
    const thing = lowerFirst(owed[0].title);
    return `${opening} ${thing} has got to?${when ? ` I asked about it ${when}.` : ''}`;
  }

  const lines = owed.map(task => {
    const when = whenAsked(task, now);
    return `• ${task.title}${when ? ` — asked ${when}` : ''}`;
  });
  return `${opening} these have got to?\n\n${lines.join('\n')}`;
}

// "The signed inventory" reads wrong in the middle of a sentence, so the
// article comes down to lower case — and only the article.
//
// Guessing more widely than this cannot be done safely: a title beginning
// "Marchetti paperwork" looks exactly like one beginning "The paperwork" to
// anything that only inspects capitals, and lowercasing somebody's name in a
// message addressed to them is worse than a slightly stiff sentence. So the
// list is short, closed, and everything not on it is left precisely as written.
const ARTICLES = new Set([
  'the', 'a', 'an', 'my', 'our', 'your', 'his', 'her', 'their',
  'this', 'that', 'these', 'those', 'some', 'any',
]);

function lowerFirst(title) {
  const text = String(title || '').trim();
  if (!text) return text;
  const [first] = text.split(/\s+/);
  if (!ARTICLES.has(first.toLowerCase())) return text;
  return text[0].toLowerCase() + text.slice(1);
}


// ── Whether you have already asked ──────────────────────────────────────────
//
// The column could say a thing had been waiting three weeks and could write the
// message asking for it, and knew nothing at all about whether you had sent one.
// So on Thursday the row read exactly as it had on Monday, before you chased —
// and the question anybody delegating twenty things a week is actually asking
// is not "how long has this been waiting". It is "have I already asked, and how
// many times", because that is what decides whether the next move is another
// email or a phone call.
//
// The record is a list of when, rather than a count and a date, because the two
// would eventually disagree and the list answers both questions without being
// asked twice.

// Enough to tell a pattern from an accident. A thing chased twenty times is not
// going to be settled by the twenty-first, and the list rides inside the same
// encrypted blob as everything else.
export const MAX_CHASES = 20;

export function chasesOf(task) {
  const raw = task && task.chases;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(at => typeof at === 'string' && !Number.isNaN(Date.parse(at)))
    .sort();
}

// The fields to save when a chase has just been sent. Oldest dropped first, so
// what is kept is what happened most recently.
export function recordChase(task, now = new Date()) {
  const kept = [...chasesOf(task), now.toISOString()].slice(-MAX_CHASES);
  return { chases: kept };
}

export function chaseCount(task) {
  return chasesOf(task).length;
}

export function lastChase(task) {
  const all = chasesOf(task);
  return all.length ? new Date(all[all.length - 1]) : null;
}

const TIMES = ['', 'once', 'twice'];
function howMany(n) {
  return TIMES[n] || `${n} times`;
}

// What the row says. The count and nothing else: a row is scanned rather than
// read, and the number is the part that changes what you do next.
export function chaseLabel(task) {
  const n = chaseCount(task);
  if (n === 0 || !task || task.completed || task.archivedAt) return null;
  return `chased ${howMany(n)}`;
}

// What the sheet says, where there is room for the rest of it.
export function chaseDetail(task, now = new Date()) {
  const n = chaseCount(task);
  if (n === 0) return null;
  const at = lastChase(task);
  const days = daysSince(at.toISOString(), now);
  const when = days === 0 ? 'earlier today'
    : days === 1 ? 'yesterday'
      : `${span(days)} ago`;
  // Dashed rather than joined with "last": "chased twice, last yesterday" is
  // the sort of sentence you have to read twice.
  return `Chased ${howMany(n)} — ${when}`;
}
