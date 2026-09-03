// Manual ordering.
//
// Priority says how a task feels; order says where you put it. Dragging is an
// explicit instruction, so it wins over priority — but only for tasks that have
// actually been placed. Everything else keeps sorting the way it always did.
//
// Pure: no React, no storage. The awkward parts here are the arithmetic of
// inserting between two neighbours and the arithmetic of turning a drag
// distance into an index, and both are worth testing without a browser.

export function orderOf(task) {
  const value = task ? task.order : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// A place between two neighbours, or null when the gap has been split so many
// times that floating point can no longer land strictly inside it. The caller
// renumbers instead of pretending.
function between(before, after) {
  if (before === null && after === null) return 0;
  if (before === null) return after - 1;
  if (after === null) return before + 1;
  const mid = (before + after) / 2;
  return mid > before && mid < after ? mid : null;
}

// Display order: placed tasks first, in the order they were placed; then
// everything untouched, still sorted the way it was before any of this existed.
export function sortForDisplay(tasks, rankOf) {
  return [...tasks].sort((a, b) => {
    const ao = orderOf(a);
    const bo = orderOf(b);
    if (ao !== null && bo !== null) return ao - bo;
    if (ao !== null) return -1;
    if (bo !== null) return 1;
    const byRank = rankOf(a) - rankOf(b);
    if (byRank !== 0) return byRank;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

// Where a new task goes: the top of its column, above anything placed there.
export function orderForNewTask(columnTasks) {
  const placed = columnTasks.map(orderOf).filter(o => o !== null);
  return placed.length ? Math.min(...placed) - 1 : 0;
}

// Moving one task, as the smallest set of changes that achieves it.
//
// Usually that is a single task taking a value between its new neighbours. It
// becomes the whole column when some tasks have never been placed and so have
// no value to sit between, or when a gap has been subdivided past the point
// floating point can represent — in both cases the column is renumbered once
// and midpoints work again afterwards.
export function moveWithin(list, fromIndex, toIndex) {
  if (fromIndex === toIndex) return [];
  if (fromIndex < 0 || fromIndex >= list.length) return [];
  if (toIndex < 0 || toIndex >= list.length) return [];

  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  if (list.every(task => orderOf(task) !== null)) {
    const value = between(
      toIndex > 0 ? orderOf(next[toIndex - 1]) : null,
      toIndex < next.length - 1 ? orderOf(next[toIndex + 1]) : null
    );
    if (value !== null) return [{ id: moved.id, order: value }];
  }

  return next.map((task, i) => ({ id: task.id, order: i }));
}

// Which row a drag has reached, given how tall each row is.
//
// Rows are not a uniform height — a two-line title is taller than a one-line
// one — so this walks outward from where the drag began, crossing a row once
// the pointer has passed that row's midpoint.
export function targetIndex(heights, fromIndex, dy) {
  let index = fromIndex;

  if (dy > 0) {
    let edge = 0;
    for (let i = fromIndex + 1; i < heights.length; i += 1) {
      const height = heights[i] || 0;
      if (dy > edge + height / 2) index = i;
      else break;
      edge += height;
    }
  } else if (dy < 0) {
    let edge = 0;
    for (let i = fromIndex - 1; i >= 0; i -= 1) {
      const height = heights[i] || 0;
      if (-dy > edge + height / 2) index = i;
      else break;
      edge += height;
    }
  }

  return index;
}

// How far a row that is not being dragged should move aside, so the list shows
// where the dragged one will land.
export function shiftFor(index, fromIndex, toIndex, draggedHeight) {
  if (fromIndex === toIndex || index === fromIndex) return 0;
  if (fromIndex < toIndex && index > fromIndex && index <= toIndex) return -draggedHeight;
  if (fromIndex > toIndex && index >= toIndex && index < fromIndex) return draggedHeight;
  return 0;
}
