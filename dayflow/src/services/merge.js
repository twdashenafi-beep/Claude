// Merge policy for syncing.
//
// Pure: no network, no storage, no clock. Everything it needs is passed in,
// which is what makes the conflict rules testable in isolation.

// Merge remote rows into local tasks. Returns the merged task list plus the
// rows that need pushing back, so one pass settles both directions.
//
// `decryptRow` returns null when a row cannot be read with the current key.
// That should not happen for your own rows, but skipping beats crashing, and it
// keeps one corrupt row from taking the whole list with it.
export function mergeTasks({ localTasks, localTombstones, remoteRows, decryptRow }) {
  const merged = new Map();
  const tombstones = new Map(localTombstones.map(t => [t.id, t]));

  for (const task of localTasks) merged.set(task.id, task);

  const toPush = [];

  for (const row of remoteRows) {
    const remoteAt = Date.parse(row.updatedAt) || 0;

    if (row.deleted) {
      const local = merged.get(row.id);
      if (local && (Date.parse(local.updatedAt) || 0) > remoteAt) {
        // A local edit newer than the tombstone wins — but the server still
        // holds the tombstone, so unless this goes back up the task is deleted
        // again on the next sync. That is the path an undo takes.
        toPush.push(local.id);
        continue;
      }
      merged.delete(row.id);
      tombstones.set(row.id, { id: row.id, updatedAt: row.updatedAt });
      continue;
    }

    // A tombstone newer than the remote row means this device deleted it after
    // that write; keep the delete and let the push carry it upstream.
    const tomb = tombstones.get(row.id);
    if (tomb && (Date.parse(tomb.updatedAt) || 0) >= remoteAt) continue;

    const local = merged.get(row.id);
    const localAt = local ? Date.parse(local.updatedAt) || 0 : -1;

    if (localAt >= remoteAt) {
      if (localAt > remoteAt) toPush.push(local.id);
      continue;
    }

    const task = decryptRow(row.ciphertext);
    if (!task) continue;
    merged.set(row.id, { ...task, id: row.id, updatedAt: row.updatedAt });
    tombstones.delete(row.id);
  }

  // Anything local the server has not seen also needs pushing.
  const remoteIds = new Set(remoteRows.map(r => r.id));
  for (const task of merged.values()) {
    if (!remoteIds.has(task.id)) toPush.push(task.id);
  }

  return {
    tasks: [...merged.values()],
    tombstones: [...tombstones.values()],
    pushIds: [...new Set(toPush)],
  };
}
