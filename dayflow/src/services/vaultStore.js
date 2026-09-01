import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabase } from './supabase';

// Where the wrapped data key lives.
//
// On the server, so a device signing in for the first time can fetch it; and
// cached locally, so unlocking works with no network. Both copies are
// ciphertext either way.

const LOCAL_KEY = '@dayflow_vault_record';

export async function readLocal() {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function writeLocal(record) {
  await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(record));
}

export async function clearLocal() {
  await AsyncStorage.removeItem(LOCAL_KEY);
}

export async function readRemote() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('vaults')
    .select('version, wrapped_by_password, wrapped_by_recovery')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    version: data.version,
    wrappedByPassword: data.wrapped_by_password,
    wrappedByRecovery: data.wrapped_by_recovery,
  };
}

export async function writeRemote(record) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { error } = await supabase.from('vaults').upsert(
    {
      user_id: userId,
      version: record.version || 1,
      wrapped_by_password: record.wrappedByPassword,
      wrapped_by_recovery: record.wrappedByRecovery,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
}
