// How long a task has been sitting there.
//
// One question asked of both columns, and the column decides what the answer
// means. In Owe Me it is a chase: somebody has had this for three weeks. In To
// Do it is the opposite admission — you have carried this for three weeks and
// not done it. A task is in one column or the other and never both, so the two
// share a single slot on the row and can never crowd each other.
//
// The app always knew. Every task records when it was made. It simply never
// said.
//
// What each column can say, and when, is not the same question:
//
//   Owe Me speaks after two days, because chasing is the entire purpose of the
//   column and the number is the thing you quote down the phone.
//
//   To Do has to wait far longer. A list that remarks on every task after two
//   days is nagging, and nagging is read once and then never again. It also
//   scales with the scope you filed the task under: a task you put on today's
//   list and have carried for three weeks is avoidance, while one you filed
//   under this month is simply not due yet.
//
// Pure: the clock is passed in.

// ── Owe Me ───────────────────────────────────────────────────────────────────

// Below this there is nothing worth saying. Something asked for this morning is
// not being waited on yet, and a list reading "waiting 0 days" against every row
// teaches you to stop reading it.
const QUIET_DAYS = 2;

// Past a fortnight, someone is late. The same red as an overdue task, because
// it means the same thing — only about somebody else.
const STALE_DAYS = 14;

// ── To Do ────────────────────────────────────────────────────────────────────

// By the scope the task was filed under, because that is the app already
// knowing how long you meant it to take. Three weeks is a failure for something
// you put on today's list and unremarkable for something you gave the month.
const CARRIED_DAYS = { day: 14, week: 30, month: 90 };

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Whole days, counted midnight to midnight rather than in 24-hour blocks. A
// task made at 23:41 has been there a day by breakfast, and the two days a year
// that are 23 or 25 hours long do not quietly cost a day.
export function daysSince(iso, now = new Date()) {
  if (!iso) return null;
  const from = new Date(iso);
  if (Number.isNaN(from.getTime())) return null;
  const days = Math.round((startOfDay(now) - startOfDay(from)) / 86400000);
  // Two devices whose clocks disagree can date a task into the future. That is
  // worth nothing but a nought.
  return days < 0 ? 0 : days;
}

// Days, then weeks, then months. The bands are chosen so no unit ever has to
// say "1" — thirteen days becomes two weeks, not one week — which keeps the
// wording out of singular and plural entirely.
//
// Shared by both columns on purpose. Two ways of saying three weeks would be
// two voices on one page.
// Exported so a chase can say "asked 3 weeks ago" in the same words the row
// uses for "waiting 3 weeks". Two ways of saying three weeks would be two
// voices for one fact.
export function span(days) {
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  // Past a year the exact count stops meaning anything: thirteen months is not
  // a number anybody acts on differently from fourteen.
  return 'over a year';
}

// What this row should say about its own age, if anything.
//
// { text, stale } — or null, which is most of the time and by design.
export function ageLabel(task, now = new Date()) {
  if (!task || task.completed) return null;

  const days = daysSince(task.createdAt, now);
  if (days === null) return null;

  if (task.taskType === 'done_for_me') {
    if (days < QUIET_DAYS) return null;
    return { text: `waiting ${span(days)}`, stale: days >= STALE_DAYS };
  }

  const threshold = CARRIED_DAYS[task.viewScope] || CARRIED_DAYS.day;
  if (days < threshold) return null;

  // Never red, however long it has been. Red on this page means somebody is
  // late, and turning your own backlog red paints the whole sheet for the one
  // person it would help least — you already know it is yours.
  return { text: `carried ${span(days)}`, stale: false };
}
