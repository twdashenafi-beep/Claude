import { Platform } from 'react-native';

// Which copy of DayFlow this is.
//
// It exists because of an afternoon spent not knowing. A change went out, the
// web deploy was green, and the phone kept showing the old screen — and there
// was no way to tell from inside the app whether the phone was running a web
// page from a stale cache or a TestFlight build that simply predated the work.
// Those are fixed in completely different places, and guessing between them
// cost more time than the change had.
//
// The app already had the answer and kept it somewhere nobody could reach: a
// build stamp printed on the first-run sync screen, which you see once, before
// there is anything to be confused about.
//
// Two different facts, because the two platforms are built by different
// machinery. The web export carries a timestamp baked in at export time; the
// native app carries the version and build number Apple itself sees, read out
// of the bundle rather than out of the manifest, so it cannot disagree with
// what TestFlight lists.
//
// Impure by design: it touches the platform. The phrasing is in deviceReport,
// which is pure and tested.

const STAMP = process.env.EXPO_PUBLIC_BUILD_ID || '';

export function buildInfo() {
  const info = { platform: Platform.OS, stamp: STAMP, version: '', build: '' };
  if (Platform.OS === 'web') return info;

  // expo-application reads CFBundleShortVersionString and CFBundleVersion off
  // the bundle. It rides in with expo-notifications and is declared directly in
  // package.json so a future tidy-up of that dependency cannot take this with
  // it silently. Wrapped, because a module that is not there must not take the
  // whole settings sheet down with it.
  try {
    // eslint-disable-next-line global-require
    const Application = require('expo-application');
    info.version = Application.nativeApplicationVersion || '';
    info.build = Application.nativeBuildVersion || '';
  } catch {
    // Left empty: buildLine says so rather than inventing a number.
  }
  return info;
}
