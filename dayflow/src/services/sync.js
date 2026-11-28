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

// ── Suggestions ─────────────────────────────────────────────────────────────
//
// Tasks proposed by agents, shared between one person's devices so a phone can
// show what the Mac collected. A table of their own; see suggestionSync.js for
// why, and for the merge.

const SUGGESTIONS = 'agent_suggestions';

// The table is added to a sync database by hand, once, and an account whose
// owner has not done that yet is not in trouble: everything else syncs as it
// did. So its absence is named rather than thrown as one more sync fault.
// PostgREST says PGRST205 when the table is not in its schema cache, and
// Postgres says 42P01.
function tableMissing(error) {
  const code = String((error && error.code) || '');
  return code === 'PGRST205' || code === '42P01';
}

export async function pullSuggestions() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from(SUGGESTIONS).select('id, ciphertext, updated_at');
  if (error) {
    if (tableMissing(error)) return { missing: true, rows: [] };
    throw error;
  }
  return { missing: false, rows: (Array.isArray(data) ? data : []).map(row => ({ id: row.id, ciphertext: row.ciphertext, updatedAt: row.updated_at })) };
}

export async function pushSuggestions(rows) {
  const supabase = getSupabase();
  if (!supabase || rows.length === 0) return;

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error('Not signed in');

  const payload = rows.map(row => ({
    id: row.id, user_id: userId, ciphertext: row.ciphertext, updated_at: row.updatedAt,
  }));
  const { error } = await supabase.from(SUGGESTIONS).upsert(payload, { onConflict: 'user_id,id' });
  if (error) throw error;
}

// As watchTasks: a change carries nothing readable, and means only "go and
// merge". Null when there is no Realtime to watch with.
export function watchSuggestions(onChange) {
  const supabase = getSupabase();
  if (!supabase) return null;
  let active = true;
  const channel = supabase
    .channel('dayflow-suggestions')
    .on('postgres_changes', { event: '*', schema: 'public', table: SUGGESTIONS }, () => {
      if (active) onChange();
    })
    .subscribe();
  return () => {
    active = false;
    supabase.removeChannel(channel);
  };
}
