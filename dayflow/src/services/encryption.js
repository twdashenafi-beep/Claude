import CryptoJS from 'crypto-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SALT_KEY = '@dayflow_salt';
const KEY_CHECK_KEY = '@dayflow_key_check';
const CHECK_PHRASE = 'DAYFLOW_VERIFIED';

// Generate a random salt
function generateSalt() {
  return CryptoJS.lib.WordArray.random(128 / 8).toString();
}

// Derive AES-256 key from password + salt using PBKDF2
function deriveKey(password, salt) {
  return CryptoJS.PBKDF2(password, salt, {
    keySize: 256 / 32,
    iterations: 10000,
  }).toString();
}

// Encrypt plaintext with AES-256
export function encrypt(text, key) {
  if (!text || !key) return text;
  try {
    return CryptoJS.AES.encrypt(text, key).toString();
  } catch {
    return text;
  }
}

// Decrypt ciphertext with AES-256
export function decrypt(ciphertext, key) {
  if (!ciphertext || !key) return ciphertext;
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key);
    const result = bytes.toString(CryptoJS.enc.Utf8);
    return result || ciphertext;
  } catch {
    return ciphertext;
  }
}

// The task fields that are encrypted at rest.
const ENCRYPTED_FIELDS = ['title', 'notes', 'owePerson', 'oweAmount'];

// Encrypt task fields (title, notes, owePerson, oweAmount)
export function encryptTask(task, key) {
  if (!key) return task;
  return {
    ...task,
    title: encrypt(task.title, key),
    notes: task.notes ? encrypt(task.notes, key) : '',
    owePerson: task.owePerson ? encrypt(task.owePerson, key) : '',
    oweAmount: task.oweAmount ? encrypt(task.oweAmount, key) : '',
  };
}

// Encrypts a whole task list, reusing ciphertext for fields that have not
// changed since the last call.
//
// Persistence re-encrypts the full list on every state change, and AES runs
// synchronously on the UI thread: at 200 tasks that is ~100ms of blocking work
// per save on desktop, worse on a phone. But almost every change — ticking a
// checkbox, changing a priority, editing a due date — touches no encrypted
// field at all, so memoising by plaintext makes those saves essentially free
// and leaves only genuinely edited fields to encrypt.
//
// The cache is rebuilt from the task list on each pass, so deleted tasks drop
// out of it and it cannot grow unbounded. It holds plaintext, so it lives only
// for the unlocked session and is discarded if the key changes.
export function createTaskEncryptor() {
  let cache = new Map();
  let cachedKey = null;

  return function encryptAll(tasks, key) {
    if (!key) return tasks;
    if (key !== cachedKey) {
      cache = new Map();
      cachedKey = key;
    }

    const next = new Map();

    const encrypted = tasks.map(task => {
      const previous = cache.get(task.id);
      const fields = {};
      const out = { ...task };

      for (const field of ENCRYPTED_FIELDS) {
        const plain = task[field];

        if (!plain) {
          // Matches the single-task path: an absent title stays as-is, the
          // other fields normalise to an empty string.
          out[field] = field === 'title' ? plain : '';
          continue;
        }

        const hit = previous && previous[field];
        if (hit && hit.plain === plain) {
          out[field] = hit.cipher;
          fields[field] = hit;
          continue;
        }

        const cipher = encrypt(plain, key);
        out[field] = cipher;
        fields[field] = { plain, cipher };
      }

      next.set(task.id, fields);
      return out;
    });

    cache = next;
    return encrypted;
  };
}

// Decrypt task fields
export function decryptTask(task, key) {
  if (!key) return task;
  return {
    ...task,
    title: decrypt(task.title, key),
    notes: task.notes ? decrypt(task.notes, key) : '',
    owePerson: task.owePerson ? decrypt(task.owePerson, key) : '',
    oweAmount: task.oweAmount ? decrypt(task.oweAmount, key) : '',
  };
}

// Setup master password (first launch)
export async function setupMasterPassword(password) {
  const salt = generateSalt();
  const key = deriveKey(password, salt);
  const check = encrypt(CHECK_PHRASE, key);

  await AsyncStorage.setItem(SALT_KEY, salt);
  await AsyncStorage.setItem(KEY_CHECK_KEY, check);

  return key;
}

// Verify master password and return derived key
export async function verifyMasterPassword(password) {
  const salt = await AsyncStorage.getItem(SALT_KEY);
  if (!salt) return null;

  const key = deriveKey(password, salt);
  const storedCheck = await AsyncStorage.getItem(KEY_CHECK_KEY);
  if (!storedCheck) return null;

  const decrypted = decrypt(storedCheck, key);
  if (decrypted === CHECK_PHRASE) return key;
  return null;
}

// Check if master password has been set up
export async function isMasterPasswordSet() {
  const salt = await AsyncStorage.getItem(SALT_KEY);
  return !!salt;
}
