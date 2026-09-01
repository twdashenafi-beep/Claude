import { supabase, isSupabaseConfigured } from './supabase';
import { deriveAccountKeys, normalizeEmail } from './crypto';
import {
  createVault, unlockWithPassword, unlockWithRecoveryCode,
  rewrapForNewPassword, rotateRecoveryCode,
} from './vault';
import * as store from './vaultStore';

// Account flows.
//
// Every one of these derives keys locally first. Supabase is only ever handed
// the auth hash as the account password; the key that opens the vault is
// returned to the caller and held in memory for the session.
//
// Each returns a `dataKey` — the key tasks are encrypted with. It is not
// derived from the password, which is what lets the password change without
// touching a single task.

export { isSupabaseConfigured };

async function loadRecord() {
  // Remote first: a device signing in for the first time has no local copy, and
  // a device that changed its password elsewhere has a stale one.
  if (isSupabaseConfigured) {
    try {
      const remote = await store.readRemote();
      if (remote) {
        await store.writeLocal(remote);
        return remote;
      }
    } catch {
      // Offline, or the row is not readable — fall back to the local copy.
    }
  }
  return store.readLocal();
}

export async function signUp(email, password) {
  const mail = normalizeEmail(email);
  const { authHash, kek } = await deriveAccountKeys(mail, password);
  const { dataKey, recoveryCode, record } = await createVault(mail, kek);

  if (!isSupabaseConfigured) {
    await store.writeLocal(record);
    return { dataKey, recoveryCode, synced: false, needsConfirmation: false };
  }

  const { data, error } = await supabase.auth.signUp({ email: mail, password: authHash });
  if (error) throw error;

  // With email confirmation on there is no session yet, so the record cannot be
  // written under RLS. It is kept locally and pushed on first sign-in.
  if (!data.session) {
    await store.writeLocal(record);
    return { dataKey, recoveryCode, synced: true, needsConfirmation: true };
  }

  await store.writeRemote(record);
  await store.writeLocal(record);
  return { dataKey, recoveryCode, synced: true, needsConfirmation: false };
}

export async function signIn(email, password) {
  const mail = normalizeEmail(email);
  const { authHash, kek } = await deriveAccountKeys(mail, password);

  if (isSupabaseConfigured) {
    const { error } = await supabase.auth.signInWithPassword({ email: mail, password: authHash });
    if (error) throw error;
  }

  const record = await loadRecord();
  if (!record) throw new Error('NO_VAULT');

  const dataKey = unlockWithPassword(record, kek);
  if (!dataKey) throw new Error('WRONG_PASSWORD');

  // A vault created before confirmation completed lives only on this device.
  if (isSupabaseConfigured) {
    try {
      if (!(await store.readRemote())) await store.writeRemote(record);
    } catch { /* offline — it will go up on a later sign-in */ }
  }

  return { dataKey, synced: isSupabaseConfigured };
}

// Recovery. Proving the recovery code opens the vault; the new password is then
// sealed around the same data key, so nothing needs re-encrypting.
//
// When sync is on, this also needs the Supabase account password changed to the
// new auth hash, which requires an authenticated session — reached through
// Supabase's own emailed reset link. Recovery therefore takes both: the emailed
// link proves the address, the code proves the vault.
export async function recoverWithCode(email, code, newPassword) {
  const mail = normalizeEmail(email);
  const record = await loadRecord();
  if (!record) throw new Error('NO_VAULT');

  const dataKey = await unlockWithRecoveryCode(record, mail, code);
  if (!dataKey) throw new Error('WRONG_RECOVERY_CODE');

  const { authHash, kek } = await deriveAccountKeys(mail, newPassword);
  const updated = rewrapForNewPassword(record, dataKey, kek);

  if (isSupabaseConfigured) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('NEEDS_EMAIL_RESET');
    const { error } = await supabase.auth.updateUser({ password: authHash });
    if (error) throw error;
    await store.writeRemote(updated);
  }

  await store.writeLocal(updated);
  return { dataKey, synced: isSupabaseConfigured };
}

// Change password on an unlocked vault. Re-seals one key; tasks are untouched.
export async function changePassword(email, dataKey, newPassword) {
  const mail = normalizeEmail(email);
  const record = await loadRecord();
  if (!record) throw new Error('NO_VAULT');

  const { authHash, kek } = await deriveAccountKeys(mail, newPassword);
  const updated = rewrapForNewPassword(record, dataKey, kek);

  if (isSupabaseConfigured) {
    const { error } = await supabase.auth.updateUser({ password: authHash });
    if (error) throw error;
    await store.writeRemote(updated);
  }
  await store.writeLocal(updated);
}

export async function newRecoveryCode(email, dataKey) {
  const record = await loadRecord();
  if (!record) throw new Error('NO_VAULT');
  const { recoveryCode, record: updated } = await rotateRecoveryCode(record, normalizeEmail(email), dataKey);
  if (isSupabaseConfigured) await store.writeRemote(updated);
  await store.writeLocal(updated);
  return recoveryCode;
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}
