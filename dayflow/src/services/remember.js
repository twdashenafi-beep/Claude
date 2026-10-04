// Letting a phone remember the key, behind your face.
//
// Deriving the key is 210,000 rounds of PBKDF2, and on a phone that is several
// seconds every single time the app is opened. The rounds cannot come down: the
// same password has to derive the same key in a browser and on a phone, or a
// vault written on one will not open on the other. So the only way to stop
// paying it twenty times a day is to not do it twenty times a day.
//
// What this changes, and it should be said plainly because it is the whole of
// the trade: until now the key lived in memory alone, so closing the app locked
// it and nothing on the device could be made to give it up. Remembered, it
// rests in the Secure Enclave and Face ID is what stands between somebody
// holding your unlocked phone and your tasks. That is how every password
// manager works, and it is still a great deal stronger than a password typed in
// public — but it is a different promise, and it is off until it is asked for.
//
// Never on the web. There is no keychain in a browser, and the alternative —
// a key sitting in the same storage as everything else — is not a weaker
// version of this idea, it is the absence of it.

import { Platform } from 'react-native';
import { parcel, unparcel } from './keyParcel';

// Required lazily and never at module scope. A build without the native module
// must behave exactly as one that has never heard of this: no offer, no error,
// no difference.
let store;
let looked = false;

function keychain() {
  if (looked) return store;
  looked = true;
  if (Platform.OS === 'web') { store = null; return store; }
  try {
    // eslint-disable-next-line global-require
    store = require('expo-secure-store');
  } catch {
    store = null;
  }
  return store;
}

const KEY = 'dayflow.vault.key';

// Whether anything is remembered, asked without asking for a face.
//
// A separate note, because the key itself cannot be looked for without
// unlocking it — and a Face ID prompt the moment the app opens, before anybody
// has asked for one, is the behaviour people turn off and never turn back on.
const MARK = 'dayflow.vault.remembered';

export function canRemember() {
  return !!keychain();
}

// Which account, if any, this device is holding a key for. No prompt.
export async function rememberedFor() {
  const box = keychain();
  if (!box) return null;
  try {
    return await box.getItemAsync(MARK);
  } catch {
    return null;
  }
}

export async function remember(email, dataKey, authHash) {
  const box = keychain();
  if (!box || !dataKey) return false;
  try {
    await box.setItemAsync(KEY, parcel(email, dataKey, authHash), {
      requireAuthentication: true,
      authenticationPrompt: 'Unlock DayFlow',
      // This device, while it is unlocked, and never in a backup that could
      // carry it to another one.
      keychainAccessible: box.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await box.setItemAsync(MARK, email || '');
    return true;
  } catch {
    // Most often a device with no biometrics enrolled, which is a refusal
    // rather than a fault. The offer simply does not take.
    await forget();
    return false;
  }
}

// Asks for a face. Null covers every way that can end — cancelled, failed, not
// there any more — because from here they are the same thing: no key, carry on
// with the password.
export async function recall() {
  const box = keychain();
  if (!box) return null;
  try {
    return unparcel(await box.getItemAsync(KEY, {
      requireAuthentication: true,
      authenticationPrompt: 'Unlock DayFlow',
    }));
  } catch {
    return null;
  }
}

export async function forget() {
  const box = keychain();
  if (!box) return;
  // Both, and the mark last: a mark without a key offers an unlock that cannot
  // happen, which is worse than not offering one.
  try { await box.deleteItemAsync(KEY); } catch { /* already gone */ }
  try { await box.deleteItemAsync(MARK); } catch { /* already gone */ }
}

// Bring a parcel written before the auth hash existed up to date.
//
// Those devices open with a face and then cannot sign in, which is the whole
// fault this closes — and asking somebody to turn Face ID off and on again to
// repair it is asking them to understand the bug. A password unlock has
// everything needed, so it simply rewrites the parcel in passing.
//
// Only when there is already one: this must never turn Face ID on for somebody
// who did not ask for it. Silent either way — it is a repair, not a feature,
// and a device that refuses is no worse off than before.
export async function refreshRemembered(email, dataKey, authHash) {
  if (!authHash || !dataKey) return false;
  const box = keychain();
  if (!box) return false;
  try {
    if (!(await box.getItemAsync(MARK))) return false;
  } catch {
    return false;
  }
  return remember(email, dataKey, authHash);
}
