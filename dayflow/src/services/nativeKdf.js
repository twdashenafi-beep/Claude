// The system's own PBKDF2, on a phone. See modules/dayflow-kdf.
//
// Read from globalThis.expo.modules, which is where an Expo native module is
// installed and the first place expo-modules-core itself looks — rather than
// through expo-modules-core, so that crypto.js stays importable by the test
// suite in plain node. Read at call time, not at module load, for the same
// reason crypto.js reads crypto.subtle late.
//
// Optional rather than required: the browser, Expo Go, and any build made
// before the module existed will not have it, and those must still open —
// through Web Crypto, or slowly through noble, but always to the same key.
let installed = null;

export function nativeKdf() {
  if (installed) return installed;
  const Kdf = typeof globalThis !== 'undefined' ? globalThis.expo?.modules?.DayflowKdf : null;
  if (!Kdf || typeof Kdf.pbkdf2 !== 'function') return null;
  return (passwordHex, saltHex, iterations, keyBytes) =>
    Kdf.pbkdf2(passwordHex, saltHex, iterations, keyBytes);
}

// For the test suite, which has no native module but has to prove that what
// crypto.js hands across — the bytes, as hex — derives the pinned keys.
export function installNativeKdf(fn) {
  installed = fn;
}
