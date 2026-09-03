import { getSupabase } from './supabase';

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
  const supabase = getSupabase();
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
  const supabase = getSupabase();
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

// Watch for changes written by your other devices.
//
// Polling every minute meant an edit on the iPad could sit unseen for most of a
// minute, and cost a request per device per minute whether or not anything had
// changed. A Realtime subscription costs one connection and delivers in about a
// second.
//
// The callback is deliberately given no payload. Rows arrive as ciphertext the
// subscription cannot read, and acting on a single row would bypass the merge
// rules — so a change simply means "something moved, go and merge properly".
//
// Returns an unsubscribe function, and null when Realtime is unavailable so the
// caller knows to keep polling instead.
export function watchTasks(onChange, onLive) {
  const supabase = getSupabase();
  if (!supabase) return null;

  let active = true;
  const channel = supabase
    .channel('dayflow-tasks')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, () => {
      if (active) onChange();
    })
    // Whether the channel actually came up is reported only here. Returning an
    // unsubscribe function regardless says nothing about it, and a caller that
    // reads that as "Realtime is running" will wait on a stream that is not.
    .subscribe(status => {
      if (active && onLive) onLive(status === 'SUBSCRIBED');
    });

  return () => {
    active = false;
    supabase.removeChannel(channel);
  };
}
