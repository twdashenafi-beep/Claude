import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Supabase client for cloud sync. Optional: with no credentials configured the
// app runs entirely on local encrypted storage and every sync call no-ops.
//
// The anon key is meant to be public — it is shipped in the app bundle by
// design. What protects your rows is Row Level Security (supabase/schema.sql),
// which scopes every row to the account that wrote it. And the rows hold only
// ciphertext, so even a total server compromise yields nothing readable.

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // There is no OAuth redirect in this app, and on web this would
        // otherwise try to parse the URL fragment on every load.
        detectSessionInUrl: false,
      },
    })
  : null;
