// Searching.
//
// A task can now be in one of three scopes, in either of two columns, in any
// project, or in the archive. That is a great many places for something to be,
// and remembering which one you filed it under is exactly the thing you were
// trying not to have to do.
//
// So search spans all of them. A search that only looked at the page you were
// already on would answer a question nobody has.
//
// Plain substring matching, case and accent insensitive. No fuzzy matching, no
// operators, no regular expressions: they add surface to learn and get in the
// way of typing three letters and finding the thing.
//
// Pure: no storage, no React.

// Accents fold so "resume" finds "résumé", and case folds so neither has to be
// typed the way it was written.
function fold(text) {
  return String(text == null ? '' : text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizeQuery(raw) {
  return fold(raw).replace(/\s+/g, ' ').trim();
}

// The fields worth searching, in the order a match in them should rank. A title
// hit is what you meant; a note hit is what you half-remember writing.
const FIELDS = [
  { key: 'title', weight: 0 },
  { key: 'owePerson', weight: 1 },
  { key: 'notes', weight: 2 },
];

// Where in a note the match was, so a result can show that rather than the
// first line of a long note that has nothing to do with the search.
export function excerpt(text, query, span = 90) {
  const body = String(text || '');
  const at = fold(body).indexOf(query);
  if (at < 0) return body.slice(0, span).trim();

  const from = Math.max(0, at - Math.floor((span - query.length) / 2));
  const to = Math.min(body.length, from + span);
  return `${from > 0 ? '…' : ''}${body.slice(from, to).trim()}${to < body.length ? '…' : ''}`;
}

// Two letters can match most of an archive, and every result is a row rendered
// in a plain list. Past this many the answer is to type a third letter, not to
// scroll — so the list stops and says so rather than quietly getting slow.
export const RESULT_LIMIT = 50;

// Matches, best first. Each carries which field matched so the result can show
// why it is there. `total` is what was found, which can exceed what is returned.
export function searchTasks(tasks, rawQuery) {
  const query = normalizeQuery(rawQuery);
  // Every return carries `total`, so a caller never has to check which kind of
  // empty it got.
  if (query.length < 2) return Object.assign([], { total: 0 });

  const hits = [];

  for (const task of tasks || []) {
    let best = null;

    for (const field of FIELDS) {
      const value = task[field.key];
      if (!value) continue;
      if (!fold(value).includes(query)) continue;
      if (!best || field.weight < best.weight) {
        best = { field: field.key, weight: field.weight };
      }
    }

    if (best) hits.push({ task, field: best.field, weight: best.weight });
  }

  // Field first, then most recently touched — a search is nearly always for
  // something you were working on lately.
  hits.sort((a, b) => {
    if (a.weight !== b.weight) return a.weight - b.weight;
    return String(b.task.updatedAt || '').localeCompare(String(a.task.updatedAt || ''));
  });

  const shown = hits.slice(0, RESULT_LIMIT);
  // Carried on the array so the caller can say "50 of 300" without running the
  // search twice.
  shown.total = hits.length;
  return shown;
}

// A result is only useful if it says where the thing is. "Sign the lease" on
// its own leaves you back where you started; "Sign the lease — Archive · Owe
// Me" is an answer.
const SCOPES = { day: 'Day', week: 'Week', month: 'Month' };

export function locationOf(task, projectLabel) {
  if (!task) return '';
  const parts = [];

  // The archive is a different place, not a different scope, so it replaces
  // the scope rather than sitting beside it.
  if (task.archivedAt) parts.push('Archive');
  else parts.push(SCOPES[task.viewScope] || 'Day');

  parts.push(task.taskType === 'done_for_me' ? 'Owe Me' : 'To Do');
  if (projectLabel) parts.push(projectLabel);
  if (task.completed && !task.archivedAt) parts.push('done');

  return parts.join('  ·  ');
}
