import { addDays, nextMonday, nextFriday, startOfMonth, endOfMonth, setHours, setMinutes } from 'date-fns';
import { capitalizeTitle } from '../utils/text.js';

// Natural language task parser
// Extracts title, date, time, priority, and view scope from free-form text

const PRIORITY_KEYWORDS = {
  high: ['urgent', 'important', 'asap', 'critical', 'high priority', 'high prio', '!!!', 'immediately'],
  low: ['low priority', 'low prio', 'whenever', 'no rush', 'eventually'],
};

// ── Dates as people say them ────────────────────────────────────────────────
//
// The list above understands "tomorrow" and "next Monday" and nothing between
// them. What it did not understand is the commonest way anybody names a day out
// loud: "Monday", "the 28th", "Monday 28". Said to the quick-add box, those
// words stayed in the title — so you got a task called "Update Eddy, Monday 28"
// with no date on it, which is worse than not trying.
//
// Pure, and separated from the patterns so the awkward parts can be tested
// without a regex in the way.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const startOfDay = date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

// "Monday" means the Monday coming. Today, if today is Monday: somebody saying
// it on a Monday morning means this evening, not in a week's time — and if they
// did mean next week, "next Monday" is already understood and says so.
export function weekdayOn(name, now = new Date()) {
  const wanted = WEEKDAYS.indexOf(String(name || '').toLowerCase());
  if (wanted < 0) return null;
  const at = startOfDay(now);
  const shift = (wanted - at.getDay() + 7) % 7;
  at.setDate(at.getDate() + shift);
  return at;
}

// "the 28th" means the next 28th there is: this month if it has not gone, the
// month after if it has. Months are walked one at a time rather than added to,
// because the 31st does not exist in four of them and landing on the 1st of the
// next month is not what anybody meant.
export function dayOfMonthOn(day, now = new Date(), monthName = null) {
  const wanted = Number(day);
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > 31) return null;

  const named = monthName === null ? -1 : MONTH_NAMES.indexOf(String(monthName).toLowerCase());
  const from = startOfDay(now);

  for (let ahead = 0; ahead < 24; ahead += 1) {
    const at = new Date(from.getFullYear(), from.getMonth() + ahead, 1);
    // A month was named: skip along until it comes round.
    if (named >= 0 && at.getMonth() !== named) continue;
    const lastDay = new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate();
    if (wanted > lastDay) continue;
    at.setDate(wanted);
    if (at >= from) return at;
  }
  return null;
}

// Which page a specific date belongs on. Today and tomorrow are the day's work;
// the rest of the week is the week's; anything further out is the month's.
export function scopeFor(date, now = new Date()) {
  if (!date) return 'day';
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
  if (days <= 1) return 'day';
  if (days <= 7) return 'week';
  return 'month';
}

const DAY_WORD = WEEKDAYS.join('|');
// Every way a month gets shortened, longest first so the alternation does not
// settle for "sep" and then choke on the "t" of "Sept". That is not a
// hypothetical: "Call John on Sept 28 at 11am" matched nothing at all, and a
// time with no date falls back to today — so the task arrived dated today, with
// the date it was given still sitting in its title.
const MONTH_WORD = MONTH_NAMES
  .flatMap(m => [...new Set([m, m.slice(0, 4), m.slice(0, 3)])])
  .sort((a, b) => b.length - a.length)
  .join('|');
// "Sept." and "Sept" are the same word with the same meaning.
const DOT = '\\.?';
// A weekday only counts as a date where it is being used as one: after a
// preposition, after a comma, or at the very end of what was said. Left
// unanchored it eats the word out of "Move the Monday meeting to Friday" and
// dates the task wrongly into the bargain. Never possessive, either —
// "Monday's meeting" is a thing, not a day.
const LEAD = '(?:^|,\\s*|\\b(?:on|for|by|to)\\s+)';
const NOT_POSSESSIVE = "(?![\u2019']s)";

const TIME_PATTERNS = [
  // "at 11am", "at 3:30pm", "at 14:00"
  { regex: /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, handler: (m) => parseTime(m[1], m[2], m[3]) },
  // No \b after the closing full stop. A word boundary needs a word character
  // on the other side of it, and "p.m." at the end of a sentence has a space or
  // nothing there — so this never matched, the pattern below caught the time
  // without the preposition, and every dictated "at 10 p.m." left a task called
  // "Call Achim at". Dictation writes periods into p.m. more often than not,
  // which made this the most common way of saying a time and the one way that
  // came out wrong.
  { regex: /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.m\.|p\.m\.)/i, handler: (m) => parseTime(m[1], m[2], m[3].replace(/\./g, '')) },
  // "11am", "3pm" standalone
  { regex: /\b(\d{1,2})\s*(am|pm)\b/i, handler: (m) => parseTime(m[1], '00', m[2]) },
  // "11 a.m." standing on its own. The pattern above wants an "at" in front of
  // it, so a perfectly ordinary way of saying eleven o'clock was not a time at
  // all — and a date with no time is not what anybody who said one meant.
  { regex: /\b(\d{1,2})(?::(\d{2}))?\s*(a\.m\.|p\.m\.)/i, handler: (m) => parseTime(m[1], m[2], m[3].replace(/\./g, '')) },
  // A clock with no am or pm on it, read as a twenty-four hour one: "at 14:00",
  // "at 22:00", "Monday 09:30".
  //
  // The comment at the top of this list has promised "at 14:00" since the list
  // was written and nothing here has ever matched it. Read literally rather
  // than guessed at: 9:30 is half past nine in the morning, and somebody who
  // means the evening writes 21:30 or "9:30pm". Guessing which half of the day
  // a bare number belongs to is exactly the kind of invention this parser does
  // not do, and the preview shows the answer before the task exists.
  //
  // Two digits after the colon are required, so "3:1" and page references stay
  // out of it, and this sits below the am/pm patterns so "10:30 pm" is still an
  // evening.
  { regex: /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/, handler: (m) => parseTime(m[1], m[2], '') },
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

// Added after the list above rather than inside it, and read after it, so that
// the phrases already understood keep their existing meanings: "next Monday"
// is matched by its own entry before a bare weekday ever gets a look.
//
// Within this list the order is longest-first. "Monday 28" has to be tried
// before "Monday" and before "28", or the first half matches and the second is
// left in the title.
const SPOKEN_DATE_PATTERNS = [
  // "Monday 28", "Monday the 28th", "on Monday the 3rd"
  {
    // The number must not be half a time. "Dentist Monday 12:30" read the 12
    // as a day of the month, dated the task in October, and left ":30" behind
    // in the title.
    regex: new RegExp(`\\b(?:on|for|by)?\\s*(${DAY_WORD})\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?::|am|pm|a\\.m|p\\.m))`, 'i'),
    // The number wins when the two disagree. A date is a fact and a weekday is
    // a memory of one, and the preview shows which day it landed on anyway.
    handler: m => ({ date: dayOfMonthOn(m[2], new Date()) }),
  },
  // "28 September", "3rd of October", "Sept 28"
  {
    regex: new RegExp(`\\b(?:on|for|by)?\\s*(?:(?:${DAY_WORD})[,\\s]+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_WORD})\\b${DOT}`, 'i'),
    handler: m => ({ date: dayOfMonthOn(m[1], new Date(), fullMonth(m[2])) }),
  },
  {
    regex: new RegExp(`\\b(?:on|for|by)?\\s*(?:(?:${DAY_WORD})[,\\s]+)?(${MONTH_WORD})\\b${DOT}\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'),
    handler: m => ({ date: dayOfMonthOn(m[2], new Date(), fullMonth(m[1])) }),
  },
  // "the 28th", "on the 3rd"
  {
    regex: /\b(?:on|by|for|before)?\s*the\s+(\d{1,2})(?:st|nd|rd|th)\b/i,
    handler: m => ({ date: dayOfMonthOn(m[1], new Date()) }),
  },
  // "on Monday", "by Friday", "…, Tuesday", or a weekday ending the sentence.
  {
    regex: new RegExp(`${LEAD}(${DAY_WORD})${NOT_POSSESSIVE}\\b`, 'i'),
    handler: m => ({ date: weekdayOn(m[1], new Date()) }),
  },
  {
    regex: new RegExp(`\\b(${DAY_WORD})${NOT_POSSESSIVE}\\s*$`, 'i'),
    handler: m => ({ date: weekdayOn(m[1], new Date()) }),
  },
  // "Book Monday 3pm". A time after the weekday is as good an anchor as a
  // preposition before it — better, really, since nobody says a day and a
  // clock time together unless they mean an appointment. Without this the day
  // stayed in the title and the task landed on today, which is the wrong day
  // said twice.
  {
    regex: new RegExp(
      `\\b(${DAY_WORD})${NOT_POSSESSIVE}\\s+(?=(?:at\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)\\b)`,
      'i',
    ),
    handler: m => ({ date: weekdayOn(m[1], new Date()) }),
  },
];

function fullMonth(word) {
  const said = String(word || '').toLowerCase().replace(/\.$/, '');
  return MONTH_NAMES.find(name => name === said || name.startsWith(said)) || null;
}

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

  // Extract time.
  //
  // What is left afterwards is what the date patterns read, with the time
  // blanked out rather than cut out so that every index still lines up with the
  // original. Without this, "Dentist Monday 12:30" hands the date patterns a
  // weekday with a number after it — which is the shape of "Monday the 28th",
  // and the rule that stops half past twelve being read as the twelfth also
  // stops Monday being read at all. The task came out dated today, with the
  // word Monday still sitting in its title.
  let dateText = text;
  for (const pat of TIME_PATTERNS) {
    const match = text.match(pat.regex);
    if (match) {
      time = pat.handler(match);
      const start = match.index;
      const end = start + match[0].length;
      removeParts.push({ start, end });
      dateText = text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
      break;
    }
  }

  // Extract date. The phrases that were always understood are tried first, so
  // none of them changes meaning; the ones people actually say are tried after.
  for (const pat of [...DATE_PATTERNS, ...SPOKEN_DATE_PATTERNS]) {
    const match = dateText.match(pat.regex);
    if (!match) continue;
    const result = pat.handler(match);
    // A pattern can match and still decline — "the 32nd" is not a date.
    if (!result || !result.date) continue;
    date = result.date;
    viewScope = result.scope || scopeFor(result.date);
    removeParts.push({ start: match.index, end: match.index + match[0].length });
    break;
  }

  // Clean title: remove extracted parts
  removeParts.sort((a, b) => b.start - a.start);
  let title = text;
  for (const part of removeParts) {
    title = title.slice(0, part.start) + title.slice(part.end);
  }
  title = title.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  // "Update Eddy, Monday 28" leaves "Update Eddy," once the date is cut out.
  // The comma was joining two halves and only one of them is left.
  // Repeated, not once. Cutting a date out of the middle of "Call John, Monday
  // Sept 28, 11 a.m." leaves two commas side by side, and stripping the last
  // one still leaves the first.
  //
  // The full stop is in the trailing set for one reason: dictation ends every
  // sentence with one. "Call Achim at 10pm." left "Call Achim ." — the stop
  // orphaned by the words cut out in front of it — and a list full of those
  // reads as though the app is broken. The cost is that "Call Jr." loses its
  // period, which is a rare and trivial loss against a common and visible one.
  // Question and exclamation marks are left alone: those carry meaning.
  title = title
    .replace(/^(?:[,;:.\u2013\u2014-]+\s*)+/, '')
    .replace(/(?:\s*[,;:.\u2013\u2014-]+)+$/, '')
    .trim();

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
    // Whether the wording chose the column, rather than the open tab deciding
    // it. True for a named column — "To Do …", "Owe me …" — and for a phrasing
    // that implies one, as "Sarah owes me the deck" does.
    //
    // The quick-add box shows this back to you while you are still speaking. A
    // command that was understood has to look different from one that was
    // misheard and left sitting in the title, or the mishearing is invisible
    // until the task turns up in the wrong list.
    commanded: owe.commanded,
    owePerson: owe.person,
    hasDate: !!date || !!time,
    hasTime: !!time,
    hasPriority: priority !== 'medium',
  };
}
