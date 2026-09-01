import { supabase } from './supabase';

// Sync engine.
//
// The server holds one row per task: an id, a ciphertext blob, a timestamp and
// a deleted flag. It cannot read any of it. Merging therefore has to work on
// timestamps alone, so the rule is last-write-wins per task, which is the right
// trade for one person editing on three devices — conflicts mean you touched
// the same task in two places within a sync interval, and the later edit is
// almost always the one you meant.
//
// Deletes are tombstones rather than removals. Without them, a device that was
// offline during a delete would re-upload the task on its next push and it
// would reappear.

const TABLE = 'tasks';

export async function pullTasks() {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(TABLE)
    .select('id, ciphertext, updated_at, deleted');
  if (error) throw error;

  return data.map(row => ({
    id: row.id,
    ciphertext: row.ciphertext,
    updatedAt: row.updated_at,
    deleted: row.deleted,
  }));
}

export async function pushTasks(rows) {
  if (!supabase || rows.length === 0) return;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error('Not signed in');

  const payload = rows.map(row => ({
    id: row.id,
    user_id: userId,
    ciphertext: row.ciphertext,
    updated_at: row.updatedAt,
    deleted: !!row.deleted,
  }));

  const { error } = await supabase.from(TABLE).upsert(payload, { onConflict: 'id' });
  if (error) throw error;
}

export { mergeTasks } from './merge';
