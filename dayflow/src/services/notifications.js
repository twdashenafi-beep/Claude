import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Local notification scheduling is a native-only capability. On web the
// scheduling APIs are not implemented, so every entry point below no-ops
// rather than rejecting into the caller.
const SUPPORTED = Platform.OS !== 'web';

// Web gets its own path. expo-notifications does not implement scheduling in a
// browser, but the browser has its own notifications — and without them a
// reminder set on the web build fired precisely nowhere.
//
// What a browser cannot do is wake itself at a future moment: scheduling needs
// a push server, which this app does not have. So alerts are raised while the
// app is open, and anything that came due while it was closed is raised on the
// next launch. The in-app strip is the part that always works; a system
// notification is the part that needs permission.
const WEB_ALERTS = Platform.OS === 'web'
  && typeof window !== 'undefined'
  && 'Notification' in window;

// 'granted' | 'denied' | 'default' — or 'unavailable' where there is nothing
// to ask for, which includes iOS Safari before the app is on the Home Screen.
export function alertPermission() {
  if (!WEB_ALERTS) return 'unavailable';
  return Notification.permission;
}

// Must be called from a tap: browsers refuse the prompt otherwise.
export async function requestAlertPermission() {
  if (!WEB_ALERTS) return 'unavailable';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function showSystemAlert(title, body, tag) {
  // silent: false is the default, but stated because it is the whole point of
  // a reminder. Whether a sound actually plays is then the operating system's
  // to decide — macOS and iOS each have a per-app setting for it.
  const options = { body, tag, silent: false };
  if (!WEB_ALERTS || Notification.permission !== 'granted') return false;
  try {
    // iOS raises notifications only through the service worker registration;
    // constructing one directly throws there.
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && registration.showNotification) {
        await registration.showNotification(title, options);
        return true;
      }
    }
    // eslint-disable-next-line no-new
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

// Configure how notifications appear when app is in foreground
if (SUPPORTED) Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Early reminder offset in minutes
export const EARLY_REMINDER_OPTIONS = [
  { label: 'None', minutes: 0 },
  { label: '5 minutes before', minutes: 5 },
  { label: '10 minutes before', minutes: 10 },
  { label: '1 day before', minutes: 1440 },
];

export async function requestPermissions() {
  if (!SUPPORTED) return false;

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function scheduleTaskNotifications(task) {
  if (!SUPPORTED) return;

  // Cancel any existing notifications for this task first
  await cancelTaskNotifications(task.id);

  if (!task.dueDate || !task.dueTime) return;

  const [h, m] = task.dueTime.split(':').map(Number);
  const dueDate = new Date(task.dueDate);
  dueDate.setHours(h, m, 0, 0);

  const now = new Date();

  // 1. Notification at exact due time
  if (dueDate > now) {
    const secondsUntilDue = Math.floor((dueDate.getTime() - now.getTime()) / 1000);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: task.title,
        body: 'Task is due now',
        data: { taskId: task.id, type: 'due' },
        sound: true,
      },
      trigger: { seconds: secondsUntilDue, type: 'timeInterval' },
      identifier: `${task.id}_due`,
    });
  }

  // 2. Early reminder if set
  const earlyMinutes = task.earlyReminderMinutes || 0;
  if (earlyMinutes > 0) {
    const earlyDate = new Date(dueDate.getTime() - earlyMinutes * 60 * 1000);
    if (earlyDate > now) {
      const secondsUntilEarly = Math.floor((earlyDate.getTime() - now.getTime()) / 1000);
      const label = EARLY_REMINDER_OPTIONS.find(o => o.minutes === earlyMinutes)?.label || `${earlyMinutes} min before`;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: task.title,
          body: `Due ${label.toLowerCase()}`,
          data: { taskId: task.id, type: 'early' },
          sound: true,
        },
        trigger: { seconds: secondsUntilEarly, type: 'timeInterval' },
        identifier: `${task.id}_early`,
      });
    }
  }
}

export async function cancelTaskNotifications(taskId) {
  if (!SUPPORTED) return;

  try {
    await Notifications.cancelScheduledNotificationAsync(`${taskId}_due`);
  } catch {}
  try {
    await Notifications.cancelScheduledNotificationAsync(`${taskId}_early`);
  } catch {}
}
