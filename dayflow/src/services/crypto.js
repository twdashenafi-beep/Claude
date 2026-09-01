import CryptoJS from 'crypto-js';

// Key derivation for an account that syncs.
//
// One password, derived twice. The auth hash is what the server is told; the
// encryption key never leaves the device. Because the server only ever sees a
// value derived *from* the master key by a one-way function, it cannot recover
// the key that decrypts your tasks — which is what makes the sync end-to-end.
//
// The email is the salt. That matters more than it looks: it means every
// device derives the same key from the same password with nothing to fetch
// first, which is exactly what a device signing in for the first time needs.
// A salt only has to be unique, not secret, and an email is both stable and
// unique to the account.
//
// Two implementations, and they must agree byte for byte or a task written on
// one device will not open on another. Web Crypto is used where it exists
// (every browser, so every device running the installed web app) because it is
// native code and lets us afford far more iterations; CryptoJS is the fallback
// for Hermes, which has no crypto.subtle. Both are PBKDF2-HMAC-SHA256, and
// there is a test that pins them together.
//
// 210k iterations is the OWASP figure for PBKDF2-HMAC-SHA256. Measured: ~100ms
// through Web Crypto, ~3s through CryptoJS. The slow path is only reached in a
// native build, where the cost lands once at unlock; the installed web app all
// three devices use takes the fast one.
const ITERATIONS = 210000;
const KEY_BYTES = 32;

const ENC_CONTEXT = 'dayflow-encryption-v1';

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

const subtle =
  typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle
    ? globalThis.crypto.subtle
    : null;

async function pbkdf2(password, salt, iterations) {
  if (subtle) {
    const encoder = new TextEncoder();
    const material = await subtle.importKey(
      'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
      material,
      KEY_BYTES * 8
    );
    return toHex(bits);
  }

  // The hasher is named explicitly rather than relying on the default: CryptoJS
  // 4.2 defaults to SHA-256, but earlier versions defaulted to SHA-1, and a
  // silent change here would make previously written data undecryptable.
  return CryptoJS.PBKDF2(password, salt, {
    keySize: (KEY_BYTES * 8) / 32,
    iterations,
    hasher: CryptoJS.algo.SHA256,
  }).toString(CryptoJS.enc.Hex);
}

export function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

// Returns { authHash, encryptionKey }. Only authHash is ever sent anywhere.
export async function deriveKeys(email, password) {
  const salt = normalizeEmail(email);
  if (!salt) throw new Error('Email is required to derive keys');

  const masterKey = await pbkdf2(password, salt, ITERATIONS);

  // A single extra round is enough here: the input is already a 256-bit key
  // from a slow derivation, so there is nothing cheap left to brute force.
  const [authHash, encryptionKey] = await Promise.all([
    pbkdf2(masterKey, password, 1),
    pbkdf2(masterKey, ENC_CONTEXT, 1),
  ]);

  return { authHash, encryptionKey };
}

export const KDF_ITERATIONS = ITERATIONS;
