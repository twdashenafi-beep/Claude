// Projects.
//
// A project is a named place with its own To Do and Owe Me, and its own Day,
// Week and Month — the same sheet, holding a different slice of the same list.
//
// Projects are stored as records alongside tasks rather than in a table of
// their own. The server holds one encrypted blob per row and knows nothing of
// what is inside, so a project needs no schema, no migration and no change to
// syncing: it merges, tombstones and undoes exactly as a task does.
//
// Pure: no storage, no React.

export const PROJECT_KIND = 'project';

// Nothing, empty and absent all mean the main list. Anything that reads a
// task's project goes through here so those three cannot drift apart.
export const EVERYTHING = '';

export function projectOf(task) {
  const id = task ? task.projectId : null;
  return typeof id === 'string' && id ? id : EVERYTHING;
}

export function isProject(record) {
  return !!record && record.kind === PROJECT_KIND;
}

export function isTask(record) {
  return !!record && record.kind !== PROJECT_KIND;
}

// Projects sort by where they were put, then by when they were made, so a list
// that has never been reordered still has a stable order.
export function sortProjects(projects) {
  return [...projects].sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : 0;
    const bo = typeof b.order === 'number' ? b.order : 0;
    if (ao !== bo) return ao - bo;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

// A new project goes after the ones already there.
export function orderForNewProject(projects) {
  const orders = projects
    .map(p => (typeof p.order === 'number' ? p.order : null))
    .filter(o => o !== null);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

export function tasksInProject(tasks, projectId) {
  const wanted = projectId || EVERYTHING;
  return tasks.filter(t => projectOf(t) === wanted);
}

// The name to show for a project id, including the main list, which has one
// even though it is not a project.
export function projectName(projects, projectId, fallback = 'Everything') {
  if (!projectId) return fallback;
  const found = projects.find(p => p.id === projectId);
  return found ? found.name : fallback;
}

// A name worth keeping: trimmed, collapsed, and capped so a tab stays a tab.
export function cleanProjectName(raw, existing = []) {
  const name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) return { ok: false, error: 'Give the project a name.' };

  // Names the project that already exists rather than echoing what was typed:
  // told "there is already a project called kitchen" after typing exactly that,
  // you learn nothing about which one it clashed with.
  const clash = existing.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (clash) return { ok: false, error: `There is already a project called “${clash.name}”.` };

  return { ok: true, name };
}
