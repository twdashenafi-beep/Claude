// A source of real randomness, installed before anything can ask for one.
//
// This file must be imported first, before any module that pulls in crypto-js.
// That is not style — it is the whole point. crypto-js reads `globalThis.crypto`
// once, when its own module body runs, and keeps whatever it found. Install the
// polyfill after that and crypto-js never sees it.
//
// Why it is needed at all: browsers and Node both provide Web Crypto, so the
// web build and the test suite have a source and this file does nothing. Hermes,
// the engine the iOS and Android builds run on, provides no `crypto` global
// whatsoever. Without this, crypto-js has no randomness — and crypto-js 4.2
// throws rather than quietly falling back to Math.random, which is the correct
// choice and also means the failure lands in AES's salt generation, inside a
// try/catch that used to return the plaintext.
//
// So the cost of not having this is not a crash. It is an app that silently
// stops encrypting.
import { getRandomValues } from 'expo-crypto';

function install() {
  if (typeof globalThis === 'undefined') return 'no global object';

  const existing = globalThis.crypto;
  if (existing && typeof existing.getRandomValues === 'function') {
    return 'platform';
  }

  // Defined rather than assigned into: on some engines `globalThis.crypto` is a
  // read-only accessor holding a partial object, and assigning to it is ignored.
  try {
    Object.defineProperty(globalThis, 'crypto', {
      value: { ...(existing || {}), getRandomValues },
      configurable: true,
      writable: true,
    });
  } catch {
    return 'failed';
  }

  return typeof globalThis.crypto.getRandomValues === 'function' ? 'expo-crypto' : 'failed';
}

// Exported for the check at startup: an app that cannot encrypt must say so
// rather than carry on writing plaintext.
export const RANDOM_SOURCE = install();

export function hasSecureRandom() {
  return RANDOM_SOURCE === 'platform' || RANDOM_SOURCE === 'expo-crypto';
}
