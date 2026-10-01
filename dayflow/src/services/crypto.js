import { pbkdf2Async as noblePbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

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
// through Web Crypto, ~280ms through @noble/hashes. The slow path is only
// reached in a native build, where the cost lands once at unlock.
//
// That fallback was crypto-js until the first build ran on a real device and
// unlocking took long enough to look like a hang. Measured on the same input,
// same iterations: crypto-js 2621ms, noble 277ms — and that was on an engine
// with a JIT. Hermes has none, so on a phone the difference is the difference
// between waiting and wondering whether it has crashed.
//
// The iteration count is the same on every platform and has to be: the same
// password must derive the same key in the browser and on the phone, or a vault
// written on one will not open on the other. Making the phone faster by asking
// it to do less work was never available.
const ITERATIONS = 210000;
const KEY_BYTES = 32;

const KEK_CONTEXT = 'dayflow-kek-v1';
const RECOVERY_CONTEXT = 'dayflow-recovery-v1';

// Crockford-style base32, minus I, L, O and U so a handwritten code cannot be
// misread. 32 characters carries 160 bits.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_CHARS = 32;

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Read at call time rather than captured at module load, for the same reason
// randomBytes below is: what the platform offers depends on import order, and a
// constant read once cannot be swapped out by a test that wants to exercise the
// other path. Both paths must be reachable in the same process or nothing can
// prove they agree.
function subtleNow() {
  const source = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  return source && source.subtle ? source.subtle : null;
}

// UTF-8, written out rather than borrowed from TextEncoder.
//
// Hermes has no TextEncoder, and this is the one function on the path that both
// implementations have to agree on byte for byte — a password with an accent in
// it derives one key or another depending on how its characters were turned
// into bytes. Doing it here means the answer cannot depend on what the platform
// happens to provide.
function utf8Bytes(text) {
  const str = String(text);
  const out = [];
  for (let i = 0; i < str.length; i += 1) {
    let code = str.codePointAt(i);
    // A character outside the basic plane is stored as two units; stepping over
    // the second stops it being encoded again as a lone surrogate.
    if (code > 0xffff) i += 1;
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

async function pbkdf2(password, salt, iterations) {
  const passwordBytes = utf8Bytes(password);
  const saltBytes = utf8Bytes(salt);
  const subtle = subtleNow();

  if (subtle) {
    const material = await subtle.importKey(
      'raw', passwordBytes, 'PBKDF2', false, ['deriveBits']
    );
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
      material,
      KEY_BYTES * 8
    );
    return toHex(bits);
  }

  // The hash is named rather than defaulted. PBKDF2 says nothing about which
  // one to use, and a library changing its mind — crypto-js once defaulted to
  // SHA-1 — would make everything already written undecryptable.
  //
  // The asynchronous one, which is the same arithmetic yielding every so often
  // rather than the same arithmetic holding the thread. It is not faster. What
  // it buys is that the app can draw while it runs: 210,000 rounds take several
  // seconds on a phone, and several seconds of a frozen screen is indisting-
  // uishable from a crash. Several seconds of something moving is a wait.
  // asyncTick is the whole of why unlocking took forty-five seconds.
  //
  // noble yields to the event loop every `asyncTick` milliseconds of work so a
  // long derivation cannot freeze the page, and its default is 10. In a browser
  // that costs nothing: the yield is a scheduler callback. On a phone there is
  // no Web Scheduling API, so it falls back to setTimeout(0) — and on React
  // Native a setTimeout is a trip through the timer bridge, not a microtask.
  //
  // Measured on the device: 45.5 s to derive one key. The hashing itself cannot
  // be more than about fourteen of those seconds even at fifty times slower
  // than a machine with a JIT, where it takes 277 ms. The rest was the yielding
  // — thousands of them, one for every ten milliseconds of work.
  //
  // A quarter of a second still redraws a spinner four times a second, which is
  // all anything on that screen needs, and it asks for the bridge twenty-five
  // times less often.
  //
  // Not a change to the output. The key is the same key; this is only how often
  // the work stops to look up. The pinned vectors in the test suite are what
  // guarantee that, and they are why this is safe to tune at all.
  return toHex(await noblePbkdf2(sha256, passwordBytes, saltBytes, {
    c: iterations,
    dkLen: KEY_BYTES,
    asyncTick: 250,
  }));
}

export function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

// Returns { authHash, kek }. Only authHash is ever sent anywhere.
//
// The kek — key-encrypting key — does not encrypt tasks. It wraps the key that
// does. That indirection is what makes a password change possible: re-wrapping
// one small key is cheap, whereas deriving the task key from the password
// directly would mean every existing task became unreadable the moment the
// password changed.
export async function deriveAccountKeys(email, password) {
  const salt = normalizeEmail(email);
  if (!salt) throw new Error('Email is required to derive keys');

  const masterKey = await pbkdf2(password, salt, ITERATIONS);

  // A single extra round is enough here: the input is already a 256-bit key
  // from a slow derivation, so there is nothing cheap left to brute force.
  const [authHash, kek] = await Promise.all([
    pbkdf2(masterKey, password, 1),
    pbkdf2(masterKey, KEK_CONTEXT, 1),
  ]);

  return { authHash, kek };
}

// Read at call time, not captured at module load: on native the source is
// installed by services/secureRandom.js, and whether that has run yet depends on
// import order rather than on anything this module can see.
//
// It was previously gated on `subtle`, which is a different capability — Hermes
// has neither, but a platform could have one without the other, and the gate
// meant a perfectly good getRandomValues went unused.
//
// There is no fallback, deliberately. Every weaker source is worse than
// stopping: the data key and the recovery code are the entire security of the
// vault, and a key drawn from Math.random is a key an attacker can re-draw.
function randomBytes(count) {
  const source = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (source && typeof source.getRandomValues === 'function') {
    return source.getRandomValues(new Uint8Array(count));
  }
  throw new Error(
    'No secure source of randomness is available on this device, so a key cannot '
    + 'be generated. This is a bug: services/secureRandom.js should have installed one.'
  );
}

// The key that actually encrypts tasks. Random, never derived from anything the
// user types, so it survives a password change untouched.
export function generateDataKey() {
  return Array.from(randomBytes(KEY_BYTES))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// A printable second way into the vault, shown once at sign-up. Without it a
// forgotten password means the data is gone — there is nothing on the server
// capable of recovering it.
export function generateRecoveryCode() {
  const bytes = randomBytes(RECOVERY_CHARS);
  const chars = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]);
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-');
}

// Accepts the code however it was transcribed — spaces, dashes, lower case, and
// the characters most often confused for one another.
export function normalizeRecoveryCode(code) {
  return (code || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

// No slow KDF here, deliberately: the code carries 160 bits of entropy, so
// stretching it would cost the user seconds and an attacker nothing.
export async function deriveRecoveryKey(code, email) {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length < RECOVERY_CHARS) throw new Error('Recovery code is incomplete');
  return pbkdf2(normalized, `${normalizeEmail(email)}|${RECOVERY_CONTEXT}`, 1);
}
