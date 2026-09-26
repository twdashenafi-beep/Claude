// Reading a calendar file.
//
// The phone's own calendar can only be read from a native build, and the app
// people are using today is the web one. So the other way in is the file every
// calendar on earth can produce: an .ics export, or the secret subscription
// link iCloud, Google and Exchange all hand out. Pick it, and the app knows
// what the day already contains.
//
// This is a deliberate subset of RFC 5545, not an implementation of it. What it
// does cover is what a working diary is actually made of:
//
//   timed events, all-day events, and events spanning midnight
//   DURATION as well as an explicit end
//   repeats — daily, weekly, monthly and yearly, with INTERVAL, COUNT, UNTIL
//     and BYDAY, which between them are almost every recurring meeting anybody
//     has ever been invited to
//   EXDATE, so a cancelled Tuesday stays cancelled
//   RECURRENCE-ID, so the week the meeting moved to Thursday shows on Thursday
//   cancelled events, which are dropped
//
// What it does not cover, and says so rather than pretending: BYSETPOS ("the
// last Friday of the month"), BYMONTHDAY lists, and named time zones. A time
// written with a TZID is read as local time on this device, which is right
// whenever the diary and the device agree about where you are and an hour or
// two out when they do not. Getting that properly right needs the whole time
// zone database, which is not worth shipping to make a free-time estimate.
//
// Pure: text in, events out. No network, no files, no clock of its own beyond
// the window it is asked about.

// Folded lines: a continuation begins with a space or a tab, and the break plus
// that one character come out. Calendars fold at 75 octets, so a meeting with a
// long title arrives in pieces.
function unfold(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

// NAME;PARAM=value;OTHER=value:the rest of the line, colons and all.
function splitLine(line) {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rest] = head.split(';');

  const params = {};
  for (const part of rest) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

// Text values escape the characters that would otherwise end them.
function unescapeText(value) {
  return String(value || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

// 20261002 or 20261002T110000, with or without a trailing Z.
//
// A bare date is all-day. A time with Z is UTC. A time without is local — to
// the TZID if there is one, and this reads it as local to the device either
// way, which is the limitation named at the top.
function parseStamp(value, params = {}) {
  const raw = String(value || '').trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return { date: new Date(Number(y), Number(m) - 1, Number(d)), allDay: true };
  }

  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (!stamp) return null;
  const [, y, m, d, hh, mm, ss, zulu] = stamp.map(v => v);
  const nums = [Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)];

  const date = zulu
    ? new Date(Date.UTC(...nums))
    : new Date(...nums);
  if (Number.isNaN(date.getTime())) return null;
  return { date, allDay: params.VALUE === 'DATE' };
}

// PT1H30M, P1D, PT45M — enough of ISO 8601 for a calendar.
function parseDuration(value) {
  const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
    .exec(String(value || '').trim());
  if (!m) return null;
  const [, sign, w, d, hh, mm, ss] = m;
  const ms = (Number(w || 0) * 7 * 86400
    + Number(d || 0) * 86400
    + Number(hh || 0) * 3600
    + Number(mm || 0) * 60
    + Number(ss || 0)) * 1000;
  return sign ? -ms : ms;
}

const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(value) {
  const rule = {};
  for (const part of String(value || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    rule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  if (!rule.FREQ) return null;

  const freq = rule.FREQ.toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;

  const until = rule.UNTIL ? parseStamp(rule.UNTIL) : null;
  const days = (rule.BYDAY || '')
    .split(',')
    .map(d => WEEKDAYS[d.trim().slice(-2).toUpperCase()])
    .filter(d => d !== undefined);

  return {
    freq,
    interval: Math.max(1, Number(rule.INTERVAL) || 1),
    count: Number(rule.COUNT) > 0 ? Number(rule.COUNT) : null,
    until: until ? until.date : null,
    days,
  };
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// A repeating event can be asked about a window ten years out. Stopping is
// better than spinning, and no real diary needs more steps than this to reach
// next week.
const MAX_STEPS = 2000;

// Every start this event has inside [from, to), the first one included.
//
// Walked one period at a time rather than by adding milliseconds: a fortnightly
// meeting stepped in 1,209,600,000ms crosses a clock change twice a year and
// arrives an hour early for the rest of the winter.
function occurrences(start, rule, from, to) {
  if (!rule) return (start >= from && start < to) ? [start] : [];

  const out = [];
  let emitted = 0;
  let cursor = new Date(start);

  const keep = when => {
    if (rule.until && when > rule.until) return false;
    if (when >= to) return false;
    if (when >= from) out.push(new Date(when));
    emitted += 1;
    return !(rule.count && emitted >= rule.count);
  };

  for (let steps = 0; steps < MAX_STEPS; steps += 1) {
    if (cursor >= to) break;
    if (rule.until && cursor > rule.until) break;

    if (rule.freq === 'WEEKLY' && rule.days.length) {
      // Every named weekday in this week, in order, starting from the week the
      // event itself falls in.
      const weekStart = new Date(cursor);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      let stop = false;
      for (const day of [...rule.days].sort((a, b) => a - b)) {
        const when = new Date(weekStart);
        when.setDate(when.getDate() + day);
        when.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
        if (when < start) continue;
        if (!keep(when)) { stop = true; break; }
      }
      if (stop) break;
      cursor.setDate(cursor.getDate() + 7 * rule.interval);
      continue;
    }

    if (!keep(new Date(cursor))) break;

    if (rule.freq === 'DAILY') cursor.setDate(cursor.getDate() + rule.interval);
    else if (rule.freq === 'WEEKLY') cursor.setDate(cursor.getDate() + 7 * rule.interval);
    else if (rule.freq === 'MONTHLY') {
      // The thirty-first does not exist in four months of the year. RFC 5545
      // says such an occurrence is skipped, not moved — which is the opposite
      // of what this app does with a repeating task of its own, where a rent
      // payment on the 31st is wanted in February whatever the calendar says.
      const wanted = start.getDate();
      let next = new Date(cursor);
      for (let tries = 0; tries < 12; tries += 1) {
        next.setDate(1);
        next.setMonth(next.getMonth() + rule.interval);
        const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        if (wanted <= last) {
          next.setDate(wanted);
          break;
        }
        // Nothing to emit this month; keep walking without counting it.
      }
      next.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
      cursor = next;
    } else {
      cursor.setFullYear(cursor.getFullYear() + rule.interval);
    }
  }
  return out;
}

// Every event in the file that touches [from, to).
export function parseICS(text, window = {}) {
  const from = window.from instanceof Date ? window.from : new Date(0);
  const to = window.to instanceof Date ? window.to : new Date(8.64e15);

  const blocks = [];
  let current = null;

  for (const line of unfold(text)) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') { current = { lines: [] }; continue; }
    if (trimmed === 'END:VEVENT') {
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const parsed = splitLine(line);
    if (parsed) current.lines.push(parsed);
  }

  const bases = [];
  const overrides = [];

  for (const block of blocks) {
    const event = { exdates: [] };
    for (const { name, params, value } of block.lines) {
      if (name === 'UID') event.uid = value.trim();
      else if (name === 'SUMMARY') event.title = unescapeText(value);
      else if (name === 'STATUS') event.status = value.trim().toUpperCase();
      else if (name === 'DTSTART') event.start = parseStamp(value, params);
      else if (name === 'DTEND') event.end = parseStamp(value, params);
      else if (name === 'DURATION') event.duration = parseDuration(value);
      else if (name === 'RRULE') event.rule = parseRule(value);
      else if (name === 'RECURRENCE-ID') event.recurrenceId = parseStamp(value, params);
      else if (name === 'EXDATE') {
        for (const one of value.split(',')) {
          const stamp = parseStamp(one, params);
          if (stamp) event.exdates.push(stamp.date);
        }
      }
    }
    if (!event.start) continue;
    if (event.status === 'CANCELLED') continue;
    (event.recurrenceId ? overrides : bases).push(event);
  }

  const out = [];
  const moved = new Set(
    overrides.map(o => `${o.uid}@${o.recurrenceId.date.toDateString()}`),
  );

  const lengthOf = event => {
    if (typeof event.duration === 'number') return event.duration;
    if (event.end) return Math.max(0, event.end.date - event.start.date);
    // An all-day event with no end is one day; a timed one with no end is a
    // moment, which most calendars show as half an hour.
    return event.start.allDay ? 86400000 : 30 * 60000;
  };

  const emit = (event, start) => {
    const ms = lengthOf(event);
    out.push({
      id: `${event.uid || event.title || 'event'}@${start.toISOString()}`,
      title: event.title || 'Busy',
      start,
      end: new Date(start.getTime() + ms),
      allDay: !!event.start.allDay,
    });
  };

  for (const event of bases) {
    const ms = lengthOf(event);
    // Widened by the event's own length, so a meeting that began before the
    // window and runs into it is not missed.
    const reach = new Date(from.getTime() - ms);
    for (const start of occurrences(event.start.date, event.rule, reach, to)) {
      if (event.exdates.some(ex => sameDay(ex, start))) continue;
      if (moved.has(`${event.uid}@${start.toDateString()}`)) continue;
      if (new Date(start.getTime() + ms) <= from) continue;
      emit(event, start);
    }
  }

  for (const event of overrides) {
    const start = event.start.date;
    const ms = lengthOf(event);
    if (new Date(start.getTime() + ms) <= from || start >= to) continue;
    emit(event, start);
  }

  return out.sort((a, b) => a.start - b.start);
}

// A quick look at a file before anybody commits to it: is this a calendar, and
// how much is in it?
export function describeICS(text) {
  const body = String(text || '');
  if (!/BEGIN:VCALENDAR/i.test(body)) return null;
  const count = (body.match(/BEGIN:VEVENT/gi) || []).length;
  const name = /X-WR-CALNAME:(.+)/i.exec(body);
  return {
    name: name ? unescapeText(name[1]) : '',
    events: count,
  };
}
