import { addDays, nextMonday, nextFriday, startOfMonth, endOfMonth, setHours, setMinutes } from 'date-fns';
import { capitalizeTitle } from '../utils/text.js';

// Natural language task parser
// Extracts title, date, time, priority, and view scope from free-form text

const PRIORITY_KEYWORDS = {
  high: ['urgent', 'important', 'asap', 'critical', 'high priority', 'high prio', '!!!', 'immediately'],
  low: ['low priority', 'low prio', 'whenever', 'no rush', 'eventually'],
};

const TIME_PATTERNS = [
  // "at 11am", "at 3:30pm", "at 14:00"
  { regex: /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, handler: (m) => parseTime(m[1], m[2], m[3]) },
  { regex: /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.m\.|p\.m\.)\b/i, handler: (m) => parseTime(m[1], m[2], m[3].replace(/\./g, '')) },
  // "11am", "3pm" standalone
  { regex: /\b(\d{1,2})\s*(am|pm)\b/i, handler: (m) => parseTime(m[1], '00', m[2]) },
  // "at noon", "at midnight"
  { regex: /\bat\s+(noon|midday)\b/i, handler: () => ({ hour: 12, minute: 0 }) },
  { regex: /\bat\s+midnight\b/i, handler: () => ({ hour: 0, minute: 0 }) },
];

const DATE_PATTERNS = [
  { regex: /\btoday\b/i, handler: () => ({ date: new Date(), scope: 'day' }) },
  { regex: /\btomorrow\b/i, handler: () => ({ date: addDays(new Date(), 1), scope: 'day' }) },
  { regex: /\bday after tomorrow\b/i, handler: () => ({ date: addDays(new Date(), 2), scope: 'day' }) },
  { regex: /\bnext monday\b/i, handler: () => ({ date: nextMonday(new Date()), scope: 'week' }) },
  { regex: /\bnext friday\b/i, handler: () => ({ date: nextFriday(new Date()), scope: 'week' }) },
  { regex: /\bnext week\b/i, handler: () => ({ date: addDays(new Date(), 7), scope: 'week' }) },
  { regex: /\bthis week\b/i, handler: () => ({ date: new Date(), scope: 'week' }) },
  { regex: /\bend of week\b/i, handler: () => ({ date: nextFriday(new Date()), scope: 'week' }) },
  { regex: /\bnext month\b/i, handler: () => ({ date: startOfMonth(addDays(endOfMonth(new Date()), 1)), scope: 'month' }) },
  { regex: /\bthis month\b/i, handler: () => ({ date: new Date(), scope: 'month' }) },
  { regex: /\bend of month\b/i, handler: () => ({ date: endOfMonth(new Date()), scope: 'month' }) },
  // "in 3 days"
  { regex: /\bin\s+(\d+)\s+days?\b/i, handler: (m) => ({ date: addDays(new Date(), parseInt(m[1])), scope: 'day' }) },
  // "in 2 weeks"
  { regex: /\bin\s+(\d+)\s+weeks?\b/i, handler: (m) => ({ date: addDays(new Date(), parseInt(m[1]) * 7), scope: 'week' }) },
];

function parseTime(hourStr, minStr, period) {
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minStr || '0', 10);
  const p = (period || '').toLowerCase();
  if (p === 'pm' && hour !== 12) hour += 12;
  if (p === 'am' && hour === 12) hour = 0;
  return { hour, minute };
}


// ── Which column, said out loud ─────────────────────────────────────────────
//
// "Owe me call Mekdi" and "To do buy milk" both open with an instruction about
// where the task goes. The instruction is not part of the task, and leaving it
// in fills the list with entries called "To Do buy milk".
//
// Only at the opening, and only as a whole phrase. "To do" is ordinary English —
// "the shopping I need to do tomorrow" is a task, not a routing command — so
// anywhere but the start it is left alone.

// Two phrasings are genuinely ambiguous and are read as commands: "To do the
// washing up" becomes "the washing up", and "Todo list app research" becomes
// "list app research". Both still land in To Do with a sensible title, which is
// why they are accepted rather than special-cased — the alternative is a list
// of exceptions that will never be complete.

// The run-up people give before naming a column: "add a task to", "put it in",
// "new". Consumed only when a column name follows it, which is why it lives
// here as a fragment rather than a pattern of its own — on its own it would
// eat the first two words of "add milk to the list".
const LEAD_IN = String.raw`(?:(?:add|put|create|make|start|new)\s+(?:a\s+|an\s+|it\s+|this\s+|the\s+)?(?:task\s+|item\s+|note\s+)?)?(?:in(?:to)?|to|under|on)?\s*`;

const COLUMN_PATTERNS = [
  { regex: new RegExp(String.raw`^\s*${LEAD_IN}(?:to[\s-]?do|todo)s?\b`, 'i'), isOwe: false },
  { regex: new RegExp(String.raw`^\s*${LEAD_IN}owe[\s-]?me\b`, 'i'), isOwe: true },
];

// ── Owe Me ──────────────────────────────────────────────────────────────────
//
// Owe Me is a follow-up list: something another person owes you and that you
// need to chase. Nothing about it is financial. The phrasings people actually
// use fall into a handful of shapes, and each puts the person somewhere
// different, so the person is captured per pattern rather than guessed at.
//
// These run after the opening commands above, and unlike them they match
// mid-sentence: "tomorrow Sarah owes me the deck" has to leave "tomorrow"
// behind for the date parser.

const OWE_PATTERNS = [
  // "Sarah owes me the Q3 numbers", "she owes me a call"
  { regex: /\b([\w'’-]+)\s+owes?\s+me\b[:,]?\s*/i, person: 1 },
  // "owe me: the signed lease"
  { regex: /\bowe\s+me\b[:,]?\s*/i, person: null },
  // "waiting on Tom for the deck", "waiting for Tom to send the deck"
  { regex: /\bwaiting\s+(?:on|for)\s+([\w'’-]+)\s+(?:for|to)\s+/i, person: 1 },
  // "chase Priya for the signature", "chase up Priya about the signature"
  { regex: /\bchase(?:\s+up)?\s+([\w'’-]+)\s+(?:for|about|on)\s+/i, person: 1 },
  // "follow up with James about the contract"
  { regex: /\bfollow(?:ing)?\s+up\s+with\s+([\w'’-]+)\s+(?:about|on|for|re)\s+/i, person: 1 },
];

// Words that sit where a name would but are not one. Without this, "waiting on
// the report" files itself under a person called "the".
const NOT_A_NAME = new Set([
  'the', 'a', 'an', 'my', 'our', 'your', 'his', 'her', 'their', 'its',
  'this', 'that', 'these', 'those', 'you', 'they', 'he', 'she', 'it', 'we', 'i',
  'someone', 'somebody', 'anyone', 'everyone', 'them', 'us',
]);

function cleanName(raw) {
  const name = String(raw || '').trim().replace(/^[^\w]+|[^\w'’-]+$/g, '');
  if (!name || NOT_A_NAME.has(name.toLowerCase())) return '';
  // Dictation lowercases names as often as not, and this is shown as a name.
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Dictation punctuates. "Owe me. Call the bank" arrives with the full stop
// still attached to the command, so taking the command out leaves the title
// starting with one — which reads as a mistake rather than as a task.
function tidy(text) {
  return String(text || '')
    .replace(/^[\s:,.;\-\u2013\u2014]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Which column this belongs in, who owes it, and the text with the routing
// words taken out so the rest of the parsing still works.
//
// `commanded` says a column was named out loud. It matters at the end: when the
// command was the whole utterance there is no task in it, and the caller needs
// to know that rather than fall back to the raw input — which is what used to
// put a task called "Owe me" in the list.
export function detectColumn(input) {
  const text = String(input || '');

  // Opening commands first. They are anchored and they carry a lead-in, so
  // "Add to owe me the deposit" loses all three words rather than stranding
  // "Add" at the front of the title.
  for (const { regex, isOwe } of COLUMN_PATTERNS) {
    const match = text.match(regex);
    if (!match) continue;
    return {
      isOwe,
      person: '',
      commanded: true,
      text: tidy(text.slice(match[0].length)),
    };
  }

  for (const { regex, person } of OWE_PATTERNS) {
    const match = text.match(regex);
    if (!match) continue;

    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    return {
      isOwe: true,
      person: person ? cleanName(match[person]) : '',
      commanded: true,
      text: tidy(`${before} ${after}`),
    };
  }

  return { isOwe: false, person: '', commanded: false, text };
}

export function parseNaturalLanguage(input) {
  const owe = detectColumn(input.trim());
  // Not `owe.text || input.trim()`. When a routing command was all that was
  // said, what is left is empty on purpose, and reaching past it for the raw
  // input puts the command back — which is the bug in one line.
  let text = owe.commanded ? owe.text : (owe.text || input.trim());
  let date = null;
  let time = null;
  let priority = 'medium';
  // Null rather than 'day' until a date phrase names one. The caller falls back
  // to the page you are looking at, and a default here would silently win that
  // fallback — everything typed while on Week or Month would land on Day.
  let viewScope = null;
  const removeParts = [];

  // Extract priority
  for (const [level, keywords] of Object.entries(PRIORITY_KEYWORDS)) {
    for (const kw of keywords) {
      const idx = text.toLowerCase().indexOf(kw);
      if (idx !== -1) {
        priority = level;
        removeParts.push({ start: idx, end: idx + kw.length });
        break;
      }
    }
  }

  // Extract time
  for (const pat of TIME_PATTERNS) {
    const match = text.match(pat.regex);
    if (match) {
      time = pat.handler(match);
      removeParts.push({ start: match.index, end: match.index + match[0].length });
      break;
    }
  }

  // Extract date
  for (const pat of DATE_PATTERNS) {
    const match = text.match(pat.regex);
    if (match) {
      const result = pat.handler(match);
      date = result.date;
      viewScope = result.scope;
      removeParts.push({ start: match.index, end: match.index + match[0].length });
      break;
    }
  }

  // Clean title: remove extracted parts
  removeParts.sort((a, b) => b.start - a.start);
  let title = text;
  for (const part of removeParts) {
    title = title.slice(0, part.start) + title.slice(part.end);
  }
  title = title.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');

  // Build date ISO
  let dateISO = null;
  let timeStr = null;
  if (date && time && typeof time.hour === 'number' && typeof time.minute === 'number') {
    try {
      date = setHours(setMinutes(date, time.minute), time.hour);
    } catch { /* keep date as-is */ }
  }
  if (date) {
    if (time && typeof time.hour === 'number') {
      timeStr = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
    }
    dateISO = date.toISOString();
  } else if (time) {
    // Time but no date = today
    let d = new Date();
    d = setHours(setMinutes(d, time.minute), time.hour);
    dateISO = d.toISOString();
    timeStr = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
  }

  // When a routing command was the whole of what was said, there is nothing
  // left to make a task out of. Falling back to the raw input here is what put
  // "Owe me" in the list as a task in its own right.
  const fallback = owe.commanded ? '' : input.trim();

  return {
    title: capitalizeTitle(title || owe.text || fallback),
    date: dateISO,
    dueDate: dateISO,
    dueTime: timeStr,
    priority,
    viewScope,
    // 'done_for_me' is what the Owe Me column filters on.
    taskType: owe.isOwe ? 'done_for_me' : 'todo',
    owePerson: owe.person,
    hasDate: !!date || !!time,
    hasTime: !!time,
    hasPriority: priority !== 'medium',
  };
}
