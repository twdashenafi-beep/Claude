/**
 * DayFlow natural-language task parser.
 *
 * Turns a line like "Call Mekdi at 7pm tomorrow, urgent" into structured task
 * fields. It is deliberately rule-based and dependency-free: no API key, no
 * network call, fully deterministic and unit-testable.
 *
 * parse("Abel owes me $20 by friday") =>
 *   { title: "Abel owes me", section: "owe_me", owedBy: "Abel",
 *     owedAmount: "$20", dueDate: "2026-09-25", ... }
 */

const WEEKDAYS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAY_RE = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join("|");

// Bare "at 5" has no am/pm. People overwhelmingly mean the afternoon/evening
// for 1–7 and the morning for 8–11, so bias that way rather than dropping it.
function disambiguateHour(hour) {
  if (hour >= 1 && hour <= 7) return hour + 12;
  return hour;
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  const out = startOfDay(d);
  out.setDate(out.getDate() + n);
  return out;
}

function nextWeekday(from, target, skipToday) {
  const base = startOfDay(from);
  let delta = (target - base.getDay() + 7) % 7;
  if (delta === 0 && skipToday) delta = 7;
  return addDays(base, delta);
}

function fmtTime(hour, minute) {
  if (hour === 24) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Pick a 2-digit year the way humans mean it: '26 -> 2026. */
function normaliseYear(raw) {
  const n = Number(raw);
  if (n >= 1000) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

export function parse(input, now = new Date()) {
  const original = String(input ?? "");
  let s = ` ${original} `;

  const out = {
    title: "",
    notes: "",
    section: "todo",
    view: "day",
    priority: "medium",
    dueDate: null,
    dueTime: null,
    owedBy: null,
    owedAmount: null,
  };

  // Consume the first match of `re`, hand the groups to `fn`, and cut the
  // matched text out of the working string so it can't land in the title.
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    if (fn(m) === false) return false;
    s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
    return true;
  };

  // ── Notes: everything after an explicit separator ─────────────────────────
  take(/\s(?:notes?|details?)\s*:\s*(.+)$/i, (m) => { out.notes = m[1].trim(); });
  take(/\s(?:--|\/\/)\s*(.+)$/, (m) => { out.notes = [out.notes, m[1].trim()].filter(Boolean).join("\n"); });

  // ── Priority ─────────────────────────────────────────────────────────────
  take(/\s(?:urgent|asap|critical|emergency|important|high[ -]?priority|top[ -]?priority)\b/i,
    () => { out.priority = "high"; });
  take(/\s(?:low[ -]?priority|no rush|whenever|someday|sometime)\b/i,
    () => { out.priority = "low"; });
  take(/!{2,}/, () => { out.priority = "high"; });

  // ── Owe Me: who owes, and how much ───────────────────────────────────────
  // "Abel owes me" / "Abel owes me $20" — keep the phrase in the title, it
  // reads better on the card, so match without consuming.
  const owes = s.match(/\b([A-Z][\w'’.-]*|[a-z][\w'’.-]*)\s+owes?\s+me\b/);
  if (owes) {
    out.section = "owe_me";
    out.owedBy = owes[1];
  } else if (/\bowes?\s+me\b/i.test(s) || /\bthey\s+owe\b/i.test(s)) {
    out.section = "owe_me";
  } else {
    take(/\sI\s+(?:lent|loaned)\s+(?:[$€£]?[\d.,]+\s*[a-z]*\s+(?:to\s+)?)?([A-Z][\w'’.-]*)/,
      (m) => { out.section = "owe_me"; out.owedBy = m[1]; return false; });
    take(/\b([A-Z][\w'’.-]*)\s+borrowed\b/,
      (m) => { out.section = "owe_me"; out.owedBy = m[1]; return false; });
    take(/\sowed\s+by\s+([\w'’.-]+)/i,
      (m) => { out.section = "owe_me"; out.owedBy = m[1]; return false; });
  }

  // Amounts run before times so "$20" is never read as 20:00.
  take(/([$€£]\s?\d[\d,]*(?:\.\d+)?)/, (m) => {
    out.owedAmount = m[1].replace(/\s/g, "");
    return false; // leave it in the title — "$20" is useful context
  });
  if (!out.owedAmount) {
    take(/\b(\d[\d,]*(?:\.\d+)?)\s*(birr|etb|usd|dollars?|eur|euros?|gbp|pounds?|kes|naira|rand)\b/i,
      (m) => {
        const cur = m[2].length <= 3 ? m[2].toUpperCase() : m[2].toLowerCase();
        out.owedAmount = `${m[1]} ${cur}`;
        return false;
      });
  }

  // ── View scope ───────────────────────────────────────────────────────────
  let viewOnly = false;
  take(/\sthis\s+week\b/i, () => { out.view = "week"; viewOnly = true; });
  take(/\sthis\s+month\b/i, () => { out.view = "month"; viewOnly = true; });
  take(/\snext\s+week\b/i, () => {
    out.view = "week";
    out.dueDate = toISODate(nextWeekday(now, 1, true)); // Monday coming up
  });
  take(/\snext\s+month\b/i, () => {
    out.view = "month";
    const d = startOfDay(now);
    out.dueDate = toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  });
  if (viewOnly && !out.dueDate) {
    // "this week" / "this month" scope the board but don't pin a day.
    out.dueDate = toISODate(startOfDay(now));
  }

  // ── Dates ────────────────────────────────────────────────────────────────
  const setDate = (d) => { out.dueDate = toISODate(d); };

  if (!out.dueDate) {
    take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, (m) => {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (Number.isNaN(d.getTime())) return false;
      setDate(d);
    });
  }
  if (!out.dueDate) {
    take(/\sday\s+after\s+tomorrow\b/i, () => setDate(addDays(now, 2)));
  }
  if (!out.dueDate) {
    take(/\s(today|tonight|tmrw|tomorrow|yesterday)\b/i, (m) => {
      const w = m[1].toLowerCase();
      if (w === "tomorrow" || w === "tmrw") setDate(addDays(now, 1));
      else if (w === "yesterday") setDate(addDays(now, -1));
      else setDate(startOfDay(now));
      if (w === "tonight") out.dueTime = out.dueTime || "20:00";
      return false; // "tonight"/"today" reads fine in the title
    });
  }
  if (!out.dueDate) {
    take(/\sin\s+(\d+)\s+(day|week|month)s?\b/i, (m) => {
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      if (unit === "day") setDate(addDays(now, n));
      else if (unit === "week") { setDate(addDays(now, n * 7)); out.view = "week"; }
      else {
        const d = startOfDay(now);
        setDate(new Date(d.getFullYear(), d.getMonth() + n, d.getDate()));
        out.view = "month";
      }
    });
  }
  if (!out.dueDate) {
    take(/\send\s+of\s+(?:the\s+)?(week|month)\b/i, (m) => {
      if (m[1].toLowerCase() === "week") {
        setDate(nextWeekday(now, 5, false)); // Friday
        out.view = "week";
      } else {
        const d = startOfDay(now);
        setDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
        out.view = "month";
      }
    });
  }
  if (!out.dueDate) {
    take(new RegExp(`\\s(next\\s+|this\\s+|on\\s+|by\\s+)?(${WEEKDAY_RE})\\b`, "i"), (m) => {
      const skipToday = /next/i.test(m[1] || "");
      setDate(nextWeekday(now, WEEKDAYS[m[2].toLowerCase()], skipToday));
    });
  }
  if (!out.dueDate) {
    // "Dec 5" / "5 Dec" / "December 5th, 2026"
    take(new RegExp(`\\s(?:on\\s+|by\\s+)?(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{2,4}))?\\b`, "i"),
      (m) => {
        const year = m[3] ? normaliseYear(m[3]) : now.getFullYear();
        const d = new Date(year, MONTHS[m[1].toLowerCase()], Number(m[2]));
        if (d.getMonth() !== MONTHS[m[1].toLowerCase()]) return false; // e.g. Feb 31
        // A bare month/day already past this year means next year.
        if (!m[3] && d < startOfDay(now)) d.setFullYear(year + 1);
        setDate(d);
      });
  }
  if (!out.dueDate) {
    take(new RegExp(`\\s(?:on\\s+|by\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\.?(?:,?\\s*(\\d{2,4}))?\\b`, "i"),
      (m) => {
        const month = MONTHS[m[2].toLowerCase()];
        const year = m[3] ? normaliseYear(m[3]) : now.getFullYear();
        const d = new Date(year, month, Number(m[1]));
        if (d.getMonth() !== month) return false;
        if (!m[3] && d < startOfDay(now)) d.setFullYear(year + 1);
        setDate(d);
      });
  }

  if (!out.dueDate) {
    // "12/5" / "12-5-2026" — month first, the convention the rest of the app uses.
    take(/\s(?:on\s+|by\s+)?(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/, (m) => {
      const month = Number(m[1]) - 1;
      const day = Number(m[2]);
      if (month < 0 || month > 11 || day < 1 || day > 31) return false;
      const year = m[3] ? normaliseYear(m[3]) : now.getFullYear();
      const d = new Date(year, month, day);
      if (d.getMonth() !== month || d.getDate() !== day) return false;
      if (!m[3] && d < startOfDay(now)) d.setFullYear(year + 1);
      setDate(d);
    });
  }

  // ── Times ────────────────────────────────────────────────────────────────
  take(/\s(?:at\s+|@\s*)?(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?\b/i, (m) => {
    let hour = Number(m[1]);
    const minute = Number(m[2]);
    const mer = (m[3] || "").replace(/\./g, "").toLowerCase();
    if (mer === "pm" && hour < 12) hour += 12;
    if (mer === "am" && hour === 12) hour = 0;
    const t = fmtTime(hour, minute);
    if (!t) return false;
    out.dueTime = t;
  });
  if (!out.dueTime) {
    take(/\s(?:at\s+|@\s*)?(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/i, (m) => {
      let hour = Number(m[1]);
      const mer = m[2].replace(/\./g, "").toLowerCase();
      if (mer === "pm" && hour < 12) hour += 12;
      if (mer === "am" && hour === 12) hour = 0;
      const t = fmtTime(hour, 0);
      if (!t) return false;
      out.dueTime = t;
    });
  }
  if (!out.dueTime) {
    take(/\s(?:at|by|@)\s*(\d{1,2})\b(?!\s*(?:st|nd|rd|th|%|min|hour|day|week|month|people|pm|am))/i, (m) => {
      const t = fmtTime(disambiguateHour(Number(m[1])), 0);
      if (!t) return false;
      out.dueTime = t;
    });
  }
  if (!out.dueTime) {
    take(/\s(noon|midday|midnight)\b/i, (m) => {
      out.dueTime = /midnight/i.test(m[1]) ? "00:00" : "12:00";
      return false;
    });
  }
  if (!out.dueTime) {
    const partOfDay = s.match(/\b(morning|afternoon|evening)\b/i);
    if (partOfDay) {
      const w = partOfDay[1].toLowerCase();
      out.dueTime = w === "morning" ? "09:00" : w === "afternoon" ? "14:00" : "18:00";
    }
  }

  // A time with no date means today — that is what "day flow" implies.
  if (out.dueTime && !out.dueDate) out.dueDate = toISODate(startOfDay(now));
  if (!out.dueDate) out.dueDate = toISODate(startOfDay(now));

  const fallback = original.trim();
  out.title = cleanTitle(s) ||
    (fallback ? fallback.charAt(0).toUpperCase() + fallback.slice(1) : "Untitled task");
  return out;
}

function cleanTitle(s) {
  let t = s.replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:please\s+)?(?:remind\s+me\s+(?:to|about)|reminder\s+to|remember\s+to|don'?t\s+forget\s+to|i\s+(?:need|have|want)\s+to|need\s+to|add\s+(?:a\s+)?task\s+to|todo|task)\b[:,]?\s*/i, "");
  t = t.replace(/^(?:please)\b[:,]?\s*/i, "");
  // Trim connectives and punctuation left behind by the extractions.
  let prev;
  do {
    prev = t;
    t = t.replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g, "");
    t = t.replace(/\s+([,;:.!?])/g, "$1");
    t = t.replace(/(^|\s)(at|on|by|for|in|to|of|the|a|an|and|around|from|due)\s*$/i, "");
    t = t.replace(/^(at|on|by|for|in|of|and|around|from|due)\s+/i, "");
    t = t.replace(/\s{2,}/g, " ").trim();
  } while (t !== prev);
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}
