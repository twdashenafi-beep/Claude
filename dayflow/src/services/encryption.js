import CryptoJS from 'crypto-js';

// Task encryption.
//
// A task is encrypted whole, as one blob, rather than field by field. Beyond
// being simpler, it means the server storing these rows learns nothing at all —
// not a title, but also not a priority, a due date, or how many notes you keep.
// Only the row id and its timestamp are legible, and those are needed to sync.
//
// The key comes from services/crypto.js and never leaves the device.

export function encrypt(text, key) {
  if (!text || !key) return text;
  try {
    return CryptoJS.AES.encrypt(text, key).toString();
  } catch {
    return text;
  }
}

export function decrypt(ciphertext, key) {
  if (!ciphertext || !key) return ciphertext;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key);
    return bytes.toString(CryptoJS.enc.Utf8) || null;
  } catch {
    return null;
  }
}

// Encrypt one task to a single string.
export function encryptTask(task, key) {
  return encrypt(JSON.stringify(task), key);
}

// Decrypt one task. Returns null if the ciphertext was not written by this key,
// which is how a wrong key is detected — callers skip what they cannot read
// rather than surfacing garbage.
export function decryptTask(ciphertext, key) {
  const json = decrypt(ciphertext, key);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Encrypts a list, reusing ciphertext for tasks that have not changed.
//
// Persistence re-encrypts on every state change and AES runs synchronously on
// the UI thread, so without this a checkbox tap would re-encrypt the entire
// list. Tasks are memoised on their serialised form, so only genuinely edited
// ones are re-encrypted. The cache is rebuilt from the list each pass, so
// deleted tasks fall out of it and it cannot grow without bound. It holds
// plaintext, so it lives only for the unlocked session.
export function createTaskEncryptor() {
  let cache = new Map();
  let cachedKey = null;

  return function encryptAll(tasks, key) {
    if (!key) return [];
    if (key !== cachedKey) {
      cache = new Map();
      cachedKey = key;
    }

    const next = new Map();

    const rows = tasks.map(task => {
      const json = JSON.stringify(task);
      const hit = cache.get(task.id);

      if (hit && hit.json === json) {
        next.set(task.id, hit);
        return { id: task.id, ciphertext: hit.ciphertext, updatedAt: task.updatedAt };
      }

      const ciphertext = encrypt(json, key);
      next.set(task.id, { json, ciphertext });
      return { id: task.id, ciphertext, updatedAt: task.updatedAt };
    });

    cache = next;
    return rows;
  };
}
