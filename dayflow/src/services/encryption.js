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
