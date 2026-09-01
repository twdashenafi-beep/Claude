import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildConfig, hasBuildConfig, loadStoredConfig, saveStoredConfig, clearStoredConfig,
} from './syncConfig';

// The Supabase client, built once the connection details are known.
//
// They can arrive two ways: baked in at build time, or entered in the app and
// kept on the device. Build-time wins. With neither, the app runs entirely on
// local encrypted storage and every sync call no-ops.
//
// The anon key is meant to be public — it is shipped in the app bundle by
// design. What protects your rows is Row Level Security (supabase/schema.sql),
// which scopes every row to the account that wrote it. And the rows hold only
// ciphertext, so even a total server compromise yields nothing readable.

let client = null;
let activeConfig = null;

function build({ url, anonKey }) {
  return createClient(url, anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // There is no OAuth redirect in this app, and on web this would
      // otherwise try to parse the URL fragment on every load.
      detectSessionInUrl: false,
    },
  });
}

// Called once at startup, before anything reads the client.
export async function initSync() {
  if (hasBuildConfig) {
    activeConfig = buildConfig;
    client = build(buildConfig);
    return true;
  }
  const stored = await loadStoredConfig();
  if (stored) {
    activeConfig = stored;
    client = build(stored);
    return true;
  }
  return false;
}

// Connects to a project entered in the app. The caller is expected to have run
// it past parseConfig and verifyConfig first.
export async function configureSync(config) {
  await saveStoredConfig(config);
  activeConfig = config;
  client = build(config);
}

// Forgets the connection. Local encrypted tasks are untouched — this only stops
// them being mirrored.
export async function disconnectSync() {
  if (client) await client.auth.signOut().catch(() => {});
  await clearStoredConfig();
  client = null;
  activeConfig = null;
}

export function getSupabase() {
  return client;
}

export function isSyncConfigured() {
  return client !== null;
}

// For display only — never the key.
export function syncProjectUrl() {
  return activeConfig ? activeConfig.url : '';
}

// True when the details came from the build, in which case the app should not
// offer to change or clear them.
export function syncIsBuiltIn() {
  return hasBuildConfig;
}
