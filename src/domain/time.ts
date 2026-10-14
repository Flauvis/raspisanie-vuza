import { Temporal } from "@js-temporal/polyfill";

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isCivilDate(value: string): boolean {
  const match = CIVIL_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  try {
    const date = Temporal.PlainDate.from({ year, month, day });
    return date.year === year && date.month === month && date.day === day;
  } catch {
    return false;
  }
}

export function isClockTime(value: string): boolean {
  return CLOCK_TIME.test(value);
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 80 || /^\s|\s$/.test(timeZone)) return false;
  try {
    Temporal.ZonedDateTime.from({
      timeZone,
      year: 2026,
      month: 1,
      day: 15,
      hour: 12,
      minute: 0,
      second: 0,
    });
    return true;
  } catch {
    return false;
  }
}

export function isRfc3339(value: string): boolean {
  if (!RFC3339.test(value)) return false;
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
}

export type LocalTimeResult =
  | { ok: true; value: string }
  | { ok: false; code: "invalid_date_time" | "invalid_local_time" };

export function localDateTimeToRfc3339(date: string, time: string, timeZone: string): LocalTimeResult {
  if (!isCivilDate(date) || !isClockTime(time) || !isValidTimeZone(timeZone)) {
    return { ok: false, code: "invalid_date_time" };
  }
  const dateMatch = CIVIL_DATE.exec(date);
  const timeMatch = CLOCK_TIME.exec(time);
  if (!dateMatch || !timeMatch) return { ok: false, code: "invalid_date_time" };

  try {
    const zoned = Temporal.ZonedDateTime.from(
      {
        timeZone,
        year: Number(dateMatch[1]),
        month: Number(dateMatch[2]),
        day: Number(dateMatch[3]),
        hour: Number(timeMatch[1]),
        minute: Number(timeMatch[2]),
        second: 0,
      },
      { disambiguation: "reject" },
    );
    return { ok: true, value: formatZoned(zoned) };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, code: "invalid_local_time" };
    return { ok: false, code: "invalid_date_time" };
  }
}

export function instantOrder(start: string, end: string): number {
  return Temporal.Instant.compare(Temporal.Instant.from(start), Temporal.Instant.from(end));
}

export function formatCivilDate(isoDate: string): string {
  const match = CIVIL_DATE.exec(isoDate);
  if (!match?.[1] || !match[2] || !match[3]) return isoDate;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function formatRfc3339(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return value;
  return `${formatCivilDate(match[1])} ${match[2]} (${match[3]})`;
}

export function formatInstantInZone(instant: string, timeZone: string): string {
  if (!isRfc3339(instant)) return instant;
  if (!isValidTimeZone(timeZone)) return instant;
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);
  return formatRfc3339(formatZoned(zoned));
}

export function compareCivilDates(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function civilDateInZone(instant: string, timeZone: string): string | null {
  if (!isRfc3339(instant) || !isValidTimeZone(timeZone)) return null;
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone);
  return `${pad(zoned.year, 4)}-${pad(zoned.month, 2)}-${pad(zoned.day, 2)}`;
}

function formatZoned(zoned: Temporal.ZonedDateTime): string {
  return `${pad(zoned.year, 4)}-${pad(zoned.month, 2)}-${pad(zoned.day, 2)}T${pad(zoned.hour, 2)}:${pad(zoned.minute, 2)}:${pad(zoned.second, 2)}${zoned.offset}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
