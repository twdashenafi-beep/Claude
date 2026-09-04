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
