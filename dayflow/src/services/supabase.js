// Optional Supabase client for cloud sync.
//
// Credentials come from the environment, never from source. Copy .env.example
// to .env and fill in your project's values; without them the app runs fully
// offline against encrypted AsyncStorage, which is the default.
//
// Note: task data is encrypted client-side before it ever leaves the device,
// so Supabase only ever stores ciphertext.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
