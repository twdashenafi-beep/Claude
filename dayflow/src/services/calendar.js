import * as Calendar from 'expo-calendar';

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

export async function syncTaskToCalendar(task) {
  try {
    const hasPermission = await requestCalendarPermissions();
    if (!hasPermission) return null;

    const calendarId = await getDefaultCalendarId();
    if (!calendarId) return null;

    const startDate = new Date(task.date);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour

    const eventId = await Calendar.createEventAsync(calendarId, {
      title: `[DayFlow] ${task.title}`,
      startDate,
      endDate,
      notes: [`Priority: ${task.priority}`, task.notes].filter(Boolean).join('\n'),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    return eventId;
  } catch (error) {
    console.warn('Calendar sync error:', error.message);
    return null;
  }
}

export async function getCalendarEvents(startDate, endDate) {
  try {
    const hasPermission = await requestCalendarPermissions();
    if (!hasPermission) return [];

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const calendarIds = calendars.map(c => c.id);

    const events = await Calendar.getEventsAsync(calendarIds, startDate, endDate);
    return events;
  } catch (error) {
    console.warn('Calendar read error:', error.message);
    return [];
  }
}
