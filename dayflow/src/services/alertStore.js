import AsyncStorage from '@react-native-async-storage/async-storage';

// Which alerts have already been shown on this device.
//
// Per device rather than synced: seeing a reminder on the Mac is not a reason
// for the iPhone in your pocket to stay silent.

const KEY = '@dayflow_alerts_shown';

export async function loadShown() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveShown(keys) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(keys));
  } catch {
    // A reminder repeating is a smaller problem than a crash on a full disk.
  }
}
