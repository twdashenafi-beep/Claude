// Which reminders have come due.
//
// Pure: no clock of its own, no storage, no browser. `now` and the set of
// alerts already shown are passed in, which is what makes the awkward parts
// testable — an alert that must not fire twice, one that must not fire for a
// task finished in the meantime, and one so old that shouting about it on next
// launch would be noise rather than a reminder.

// A task alerts at its due time, and again earlier if an early reminder is set.
export function alertTimesFor(task) {
  if (!task || !task.dueDate || !task.dueTime) return null;

  const [h, m] = String(task.dueTime).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;

  const at = new Date(task.dueDate);
  if (Number.isNaN(at.getTime())) return null;
  at.setHours(h, m, 0, 0);

  const early = Number(task.earlyReminderMinutes) || 0;
  return {
    due: at.getTime(),
    early: early > 0 ? at.getTime() - early * 60000 : null,
  };
}

// Identifies one alert for one task at one moment. The time is part of it, so
// moving a task's due time gives it a fresh alert rather than a silent one.
export function alertKey(taskId, kind, at) {
  return `${taskId}:${kind}:${at}`;
}

// Anything that has come due, has not been shown, and is still worth saying.
//
// `graceMs` is what stops a fortnight of missed reminders arriving at once the
// next time the app is opened.
export function pendingAlerts({ tasks, now, shown, graceMs = 12 * 60 * 60 * 1000 }) {
  const seen = new Set(shown || []);
  const out = [];

  for (const task of tasks || []) {
    if (task.completed) continue;
    const times = alertTimesFor(task);
    if (!times) continue;

    for (const kind of ['early', 'due']) {
      const at = times[kind];
      if (typeof at !== 'number') continue;
      if (at > now) continue;
      if (now - at > graceMs) continue;

      const key = alertKey(task.id, kind, at);
      if (seen.has(key)) continue;
      out.push({ task, kind, at, key });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}

// When it is due.
function when(alert) {
  if (alert.kind === 'due') return 'Due now';
  const minutes = Number(alert.task.earlyReminderMinutes) || 0;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `Due in ${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `Due in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `Due in ${minutes} minutes`;
}

// What the alert says: when it is due, and which project it belongs to.
//
// The project is the half that was missing. A reminder arriving on a phone
// says a title and nothing else, and a title on its own is exactly as much use
// as remembering there was something — "Call about the survey" tells you
// nothing about which of two houses it concerns.
export function alertBody(alert, where = '') {
  const said = when(alert);
  return where ? `${said}  ·  ${where}` : said;
}

// One line for the strip, whatever the number of them.
//
// It used to count them: "2 tasks due", which is a notification about the
// existence of notifications. It names the first and says how many others are
// behind it, and tapping it goes there — which is what a person wanted from
// the moment they looked up.
export function alertSummary(alerts, whereOf) {
  const list = (Array.isArray(alerts) ? alerts : []).filter(a => a && a.task);
  if (list.length === 0) return '';

  const [first] = list;
  const where = typeof whereOf === 'function' ? whereOf(first.task) || '' : '';
  const head = `${alertBody(first, where)} — ${first.task.title}`;
  if (list.length === 1) return head;

  const rest = list.length - 1;
  return `${head}, and ${rest} more`;
}

// Keys worth keeping. Old ones only exist to stop a repeat, and once an alert
// is past the grace window it can no longer fire anyway.
export function pruneShown(shown, now, graceMs = 12 * 60 * 60 * 1000) {
  return (shown || []).filter(key => {
    const at = Number(String(key).split(':').pop());
    return Number.isFinite(at) && now - at <= graceMs;
  });
}
