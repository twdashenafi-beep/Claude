import AsyncStorage from '@react-native-async-storage/async-storage';

// Where the Supabase connection details come from.
//
// Neither of them is a secret. The anon key is designed to be public — it ships
// in the JavaScript of every Supabase web app there is — and what protects the
// rows is Row Level Security plus the fact that they hold nothing but
// ciphertext. So there is no reason these have to be baked in at build time,
// and asking the user for them once is far less error-prone than routing them
// through a CI secret store where a typo is invisible until the next deploy.
//
// Build-time values still win when present, so a store build ships already
// connected and never shows the setup screen.

const STORAGE_KEY = '@dayflow_sync_config';

export const buildConfig = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
};

export const hasBuildConfig = !!(buildConfig.url && buildConfig.anonKey);

export { parseConfig, verifyConfig, normalizeUrl, normalizeKey, keyRole } from './configParse';

// --- storage -------------------------------------------------------------

export async function loadStoredConfig() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.url && parsed.anonKey) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function saveStoredConfig(config) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export async function clearStoredConfig() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// Remembering that the offer was declined, so a device chosen to stay local is
// not asked again on every launch.
const SKIP_KEY = '@dayflow_sync_skipped';

export async function markSyncSkipped() {
  await AsyncStorage.setItem(SKIP_KEY, '1');
}

export async function wasSyncSkipped() {
  try {
    return (await AsyncStorage.getItem(SKIP_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function clearSyncSkipped() {
  await AsyncStorage.removeItem(SKIP_KEY);
}
