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
