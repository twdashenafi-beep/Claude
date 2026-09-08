// Merge policy for syncing.
//
// Pure: no network, no storage, no clock. Everything it needs is passed in,
// which is what makes the conflict rules testable in isolation.

// Merge remote rows into local tasks. Returns the merged task list plus the
// rows that need pushing back, so one pass settles both directions.
//
// `decryptRow` returns null when a row cannot be read with the current key.
// That should not happen for your own rows, but skipping beats crashing, and it
// keeps one corrupt row from taking the whole list with it. A decryptRow that
// throws is treated the same way, as is a row that is not an object: a single
// bad entry must not be able to stop syncing altogether.
export function mergeTasks({ localTasks, localTombstones, remoteRows, decryptRow }) {
  const merged = new Map();
  const tombstones = new Map(localTombstones.map(t => [t.id, t]));

  for (const task of localTasks) merged.set(task.id, task);

  const toPush = [];

  // A response is not always shaped like one. A null or non-object entry used to
  // throw on the first property read, which stopped the whole merge — nothing
  // synced at all, in either direction, until it went away. Filtered once here
  // rather than guarded at each use, because the list is read twice and the
  // second read is the one that was missed.
  const rows = (remoteRows || []).filter(r => r && typeof r === 'object' && r.id);

  for (const row of rows) {
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
      // Keep the later of the two stamps. Taking the remote one unconditionally
      // would age a newer local delete backwards, and it would then look like
      // the server already knew about it.
      const held = tombstones.get(row.id);
      const heldAt = held ? Date.parse(held.updatedAt) || 0 : -1;
      if (remoteAt > heldAt) tombstones.set(row.id, { id: row.id, updatedAt: row.updatedAt });
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

    // The promise this file makes two paragraphs up — that one unreadable row
    // cannot take the list with it — held only for a decryptRow that returned
    // null. One that threw took the merge down with it. Now both mean skip.
    let task = null;
    try {
      task = decryptRow(row.ciphertext);
    } catch {
      task = null;
    }
    if (!task) continue;
    merged.set(row.id, { ...task, id: row.id, updatedAt: row.updatedAt });
    tombstones.delete(row.id);
  }

  // Anything local the server has not seen also needs pushing.
  const remoteById = new Map(rows.map(r => [r.id, r]));
  for (const task of merged.values()) {
    if (!remoteById.has(task.id)) toPush.push(task.id);
  }

  // Which tombstones the server has not already recorded.
  //
  // Sending all of them every time meant every sync wrote to the server, every
  // write raised a change event, and every change event asked for another sync
  // — so a single delete left the app syncing in a loop for good.
  const tombstonesToPush = [];
  for (const tomb of tombstones.values()) {
    const row = remoteById.get(tomb.id);
    const tombAt = Date.parse(tomb.updatedAt) || 0;
    const known = row && row.deleted && (Date.parse(row.updatedAt) || 0) >= tombAt;
    if (!known) tombstonesToPush.push(tomb.id);
  }

  return {
    tasks: [...merged.values()],
    tombstones: [...tombstones.values()],
    pushIds: [...new Set(toPush)],
    tombstonePushIds: [...new Set(tombstonesToPush)],
  };
}
