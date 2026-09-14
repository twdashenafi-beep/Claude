// Putting a dated task in the device's calendar.
//
// Not a calendar of its own. The phone already has one, with your meetings and
// other people's invitations in it, and a second one showing only DayFlow tasks
// would be the least useful calendar on the device. This is a one-way door: a
// task you have given a date to can be handed over to the calendar that already
// knows about your day.
//
// Native only. There is no web equivalent worth pretending about, so the button
// that calls this is hidden there rather than offered and quietly failing.
import * as Calendar from 'expo-calendar';
import { calendarWindow } from './due';

export async function requestCalendarPermissions() {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

export async function getDefaultCalendarId() {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const defaultCal = calendars.find(
    c => c.allowsModifications && (c.isPrimary || c.source?.name === 'iCloud')
  ) || calendars.find(c => c.allowsModifications);
  return defaultCal?.id || null;
}

// Returns the new event's id, or null if there was nothing to file or nowhere
// to file it.
export async function syncTaskToCalendar(task) {
  try {
    // The date and the time, together.
    //
    // This used to read the date field alone, which does not carry the time —
    // the app keeps the two apart and combines them everywhere else. So a task
    // due at half past five went into the calendar at midnight, on the right
    // day and at emphatically the wrong hour. It also had no way of knowing
    // whether a date had been chosen at all, and every task carries one
    // whether or not anybody picked it, so an undated task was filed at the
    // second it was created.
    const when = calendarWindow(task);
    if (!when) return null;

    const hasPermission = await requestCalendarPermissions();
    if (!hasPermission) return null;

    const calendarId = await getDefaultCalendarId();
    if (!calendarId) return null;

    const eventId = await Calendar.createEventAsync(calendarId, {
      title: `[DayFlow] ${task.title}`,
      startDate: when.startDate,
      endDate: when.endDate,
      allDay: when.allDay,
      notes: [`Priority: ${task.priority}`, task.notes].filter(Boolean).join('\n'),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    return eventId;
  } catch (error) {
    console.warn('Calendar sync error:', error.message);
    return null;
  }
}
