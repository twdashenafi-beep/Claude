import CryptoJS from 'crypto-js';

// Random task id.
//
// Deliberately not `uuid`: on Hermes there is no global crypto.getRandomValues,
// so uuid v13 throws at runtime in a native build unless a polyfill is
// installed. CryptoJS is already a dependency (it powers encryption.js) and
// its PRNG works identically on web, iOS and Android.
export function newId() {
  return CryptoJS.lib.WordArray.random(16).toString();
}
