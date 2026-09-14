// How long you have been waiting.
//
// Owe Me is a chasing list. Its rows name the thing and the person and stop
// there, so one asked for this morning and one asked for six weeks ago read
// exactly alike — and the question you ask before picking up the phone is
// always the same one: how long has this been sitting?
//
// The app already knows. Every task records when it was made. It simply never
// said.
//
// The first day or two stays quiet on purpose. Something asked for this morning
// is not being waited on yet, and a list that says "waiting 0 days" against
// everything teaches you to stop reading it.
//
// Pure: the clock is passed in.

// Below this there is nothing worth saying.
const QUIET_DAYS = 2;

// Past a fortnight, someone is late. The same red as an overdue task, because
// it means the same thing — only about somebody else.
const STALE_DAYS = 14;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysWaiting(task, now = new Date()) {
  if (!task || !task.createdAt) return null;
  const from = new Date(task.createdAt);
  if (Number.isNaN(from.getTime())) return null;
  const days = Math.round((startOfDay(now) - startOfDay(from)) / 86400000);
  return days < 0 ? 0 : days;
}

// { text, stale } — or null when there is nothing worth saying.
export function waitingLabel(task, now = new Date()) {
  if (!task || task.completed) return null;
  if (task.taskType !== 'done_for_me') return null;

  const days = daysWaiting(task, now);
  if (days === null || days < QUIET_DAYS) return null;

  const stale = days >= STALE_DAYS;

  // Days, then weeks, then months. The thresholds are chosen so no unit ever
  // has to say "1" — thirteen days becomes two weeks, not one — which keeps
  // the wording out of singular and plural entirely.
  let text;
  if (days < 14) text = `waiting ${days} days`;
  else if (days < 60) text = `waiting ${Math.round(days / 7)} weeks`;
  else if (days < 365) text = `waiting ${Math.round(days / 30)} months`;
  // Past a year the exact count stops meaning anything — thirteen months is
  // not a number anybody acts on differently from fourteen.
  else text = 'waiting over a year';

  return { text, stale };
}
