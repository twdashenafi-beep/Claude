import { encrypt, decrypt } from './encryption.js';
import {
  generateDataKey, generateRecoveryCode, deriveRecoveryKey,
} from './crypto.js';

// The vault record: one data key, wrapped twice.
//
// Tasks are encrypted with a random data key that no human ever types. That key
// is then stored twice over — once sealed by the key your password derives, and
// once by a recovery code you keep. Either opens it; neither reveals the other.
//
// Two things fall out of this that a password-derived key cannot do:
//
//   Changing your password re-seals one small key. Nothing else is touched, so
//   a vault of ten thousand tasks changes password as fast as an empty one —
//   and, more to the point, does not become unreadable in the process.
//
//   A forgotten password stops being fatal. Without a second wrapping there is
//   nothing on any server capable of recovery, because the server has never
//   held anything that could decrypt.
//
// The record is ciphertext, so it is safe to store on the server, which is what
// lets a newly signed-in device obtain the data key at all.

const MARKER = 'DAYFLOW_VAULT_V1';

function seal(dataKey, wrappingKey) {
  // The marker is how an unwrap proves it succeeded: AES with the wrong key
  // yields garbage rather than an error, so without something known to check
  // against, a bad key would surface as unreadable tasks much later.
  return encrypt(JSON.stringify({ marker: MARKER, dataKey }), wrappingKey);
}

function open(wrapped, wrappingKey) {
  const json = decrypt(wrapped, wrappingKey);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && parsed.marker === MARKER ? parsed.dataKey : null;
  } catch {
    return null;
  }
}

// New account. Returns the data key for immediate use, the record to store, and
// the recovery code — which is the only time it exists in readable form.
export async function createVault(email, kek) {
  const dataKey = generateDataKey();
  const recoveryCode = generateRecoveryCode();
  const recoveryKey = await deriveRecoveryKey(recoveryCode, email);

  return {
    dataKey,
    recoveryCode,
    record: {
      version: 1,
      wrappedByPassword: seal(dataKey, kek),
      wrappedByRecovery: seal(dataKey, recoveryKey),
    },
  };
}

export function unlockWithPassword(record, kek) {
  if (!record?.wrappedByPassword) return null;
  return open(record.wrappedByPassword, kek);
}

export async function unlockWithRecoveryCode(record, email, code) {
  if (!record?.wrappedByRecovery) return null;
  const recoveryKey = await deriveRecoveryKey(code, email);
  return open(record.wrappedByRecovery, recoveryKey);
}

// Re-seal under a new password. The data key is unchanged, so every task stays
// exactly as encrypted as it was — this is the whole point of the indirection.
export function rewrapForNewPassword(record, dataKey, newKek) {
  return {
    ...record,
    version: 1,
    wrappedByPassword: seal(dataKey, newKek),
  };
}

// Issue a fresh recovery code, invalidating the old one.
export async function rotateRecoveryCode(record, email, dataKey) {
  const recoveryCode = generateRecoveryCode();
  const recoveryKey = await deriveRecoveryKey(recoveryCode, email);
  return {
    recoveryCode,
    record: { ...record, version: 1, wrappedByRecovery: seal(dataKey, recoveryKey) },
  };
}
