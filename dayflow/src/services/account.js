import { supabase, isSupabaseConfigured } from './supabase';
import { deriveKeys, normalizeEmail } from './crypto';

// Account handling.
//
// Every call derives the keys locally first and hands Supabase only the auth
// hash as the account password. The encryption key is returned to the caller
// and kept in memory for the session — it is never stored, never transmitted,
// and cannot be recovered from anything the server holds.

export { isSupabaseConfigured };

export async function signUp(email, password) {
  if (!supabase) throw new Error('Cloud sync is not configured on this build.');

  const { authHash, encryptionKey } = await deriveKeys(email, password);
  const { data, error } = await supabase.auth.signUp({
    email: normalizeEmail(email),
    password: authHash,
  });
  if (error) throw error;

  // With email confirmation enabled, there is no session until the link is
  // clicked. The caller needs to know rather than assuming it is signed in.
  return { encryptionKey, session: data.session, needsConfirmation: !data.session };
}

export async function signIn(email, password) {
  if (!supabase) throw new Error('Cloud sync is not configured on this build.');

  const { authHash, encryptionKey } = await deriveKeys(email, password);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password: authHash,
  });
  if (error) throw error;

  return { encryptionKey, session: data.session };
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export async function currentEmail() {
  const session = await getSession();
  return session?.user?.email || null;
}
