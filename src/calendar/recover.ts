import { CALENDAR_SUMMARY, type ListedCalendar } from "./test-write";

export interface RecoverableCalendar {
  id: string;
  summary: string;
  hasAppEvents: boolean;
}

export function selectRecoverableCalendars(
  calendars: readonly ListedCalendar[],
  appEventCounts: ReadonlyMap<string, number>,
): RecoverableCalendar[] {
  const found: RecoverableCalendar[] = [];
  for (const calendar of calendars) {
    if (calendar.primary === true) continue;
    if (!calendar.id || calendar.id.includes("://")) continue;
    const count = appEventCounts.get(calendar.id);
    if (count === undefined) continue;
    const titleMatch = calendar.summary === CALENDAR_SUMMARY;
    if (!titleMatch && count === 0) continue;
    found.push({ id: calendar.id, summary: calendar.summary, hasAppEvents: count > 0 });
  }
  return found;
}
