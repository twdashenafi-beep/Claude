// The archive.
//
// Finishing something and no longer wanting it on the page are different
// wishes, and the second used to destroy the record of the first. Anything
// completed goes here instead of away, so what you got done survives clearing
// your list.
//
// An archived task is still a task, in the same list, with a date on it. That
// keeps it syncing, merging and decrypting exactly as before — nothing new to
// store and nothing new to go wrong.
//
// Pure: no storage, no React, no clock of its own.

export const ARCHIVE = '__archive';

export function isArchived(task) {
  return !!task && typeof task.archivedAt === 'string' && task.archivedAt.length > 0;
}

// Deleting means two things depending on what you press it on, so the caller
// has to know which it is about to do — and say so afterwards.
export function deletionOf(task) {
  return task && task.completed ? 'archive' : 'delete';
}

// Newest first: an archive is read backwards, from what you just finished.
export function sortArchive(tasks) {
  return [...tasks].sort((a, b) =>
    String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')));
}

// A year is where a record stops being read and starts being stored.
//
// Nothing has ever left here. That is the right default — finishing something
// and losing the record of it are different things — but it has only one way
// out, and it is a cliff: EMPTY, all of it, for ever. Three hundred records
// become three thousand, and the day the storage runs out the only tool is the
// one nobody wants to use.
//
// So a slope instead. Anything over a year old folds behind a line that says
// how much is there. It is still kept, still searched, still in the backup, and
// still one tap away — it is just not what the page opens with, because a to-do
// archive is not a legal record and work from two years ago has no reader.
const YEAR_DAYS = 365;

// { recent, older } — split rather than filtered, so the page can say what it
// is not showing. A record with no date at all counts as recent: it is more
// likely to be a bug in something that wrote it than a task from 2019, and
// hiding it would hide the evidence.
export function byAge(tasks, now = new Date(), days = YEAR_DAYS) {
  const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const edge = at.getTime() - days * 86400000;

  const recent = [];
  const older = [];
  for (const task of tasks || []) {
    if (!task) continue;
    // Date.parse gives NaN for a missing or unreadable date, and NaN is not less
    // than anything, so a record with no date falls to `recent` on its own. The
    // guard that used to be here checked for that and changed nothing. What
    // would change it is coercing the NaN away — `|| 0` would date every broken
    // record to 1970 and fold the evidence out of sight.
    const filed = Date.parse(task.archivedAt);
    (filed < edge ? older : recent).push(task);
  }
  return { recent, older };
}

// How much is folded away, said as a sentence rather than a count on its own.
export function foldedLine(older) {
  const many = (older || []).length;
  if (many === 0) return null;
  return `${many} finished more than a year ago`;
}

// Grouped by the day they were filed, because "what did I get done on Tuesday"
// is the question an archive is for.
export function groupByDay(tasks, formatDay) {
  const groups = [];
  const seen = new Map();

  for (const task of sortArchive(tasks)) {
    const day = String(task.archivedAt || '').slice(0, 10);
    if (!seen.has(day)) {
      const group = { day, label: formatDay ? formatDay(day) : day, tasks: [] };
      seen.set(day, group);
      groups.push(group);
    }
    seen.get(day).tasks.push(task);
  }

  return groups;
}
