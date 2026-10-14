export function googleCalendarUrl(calendarId: string | null): string | null {
  if (!calendarId) return null;
  const trimmed = calendarId.trim();
  if (!trimmed || trimmed.length > 200 || /\s|:\/\//.test(trimmed)) return null;
  return `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(trimmed)}`;
}
