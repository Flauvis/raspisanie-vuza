import { canonicalStringify, sha256Hex } from "./canonical";
import {
  compareCivilDates,
  instantOrder,
  isCivilDate,
  isClockTime,
  isRfc3339,
  isValidTimeZone,
  localDateTimeToRfc3339,
} from "./time";
import type {
  CoverageStatus,
  Lesson,
  NormalizeInput,
  RawLessonRecord,
  ScheduleReadResult,
  ScheduleSnapshot,
  ScheduleWarning,
} from "./types";

const SOURCE_KEY = /^[a-z0-9:_-]{1,80}$/;
const MISSING_ROOM_LABEL = "Аудитория не указана";
export const DEFAULT_LESSON_TYPE = "оффлайн";

interface PreparedRecord {
  index: number;
  rowNumber: number;
  sourceLessonId?: string;
  title: string;
  sourceDate: string;
  start: string;
  end: string;
  room?: string;
  teacher?: string;
  group?: string;
  lessonType?: string;
  building?: string;
  fingerprint: string;
}

export function roomLabel(room: string | undefined): string {
  return room ? room : MISSING_ROOM_LABEL;
}

export async function normalizeSchedule(input: NormalizeInput): Promise<ScheduleReadResult> {
  if (input.pageState === "logged_out") {
    return unavailable(
      "logged_out",
      "Сессия кабинета не активна. Занятия со страницы не прочитаны, события календаря не изменяются.",
    );
  }
  if (input.pageState === "not_configured") {
    return unavailable("adapter_not_configured", "Адаптер сайта не настроен. Разметка страницы не читается.");
  }
  if (!SOURCE_KEY.test(input.sourceKey) || !input.parserVersion.trim()) {
    return unavailable("invalid_source", "Источник снимка задан неполно.");
  }
  if (!input.timeZone.trim()) {
    return unavailable(
      "timezone_missing",
      "Часовой пояс вуза не задан. Часовой пояс компьютера не используется.",
    );
  }
  if (!isValidTimeZone(input.timeZone)) {
    return unavailable("invalid_timezone", "Часовой пояс вуза указан неверно.");
  }
  if (!isRfc3339(input.capturedAt)) {
    return unavailable("invalid_captured_at", "Время снимка записано в неверном формате.");
  }
  if (!isValidCoverage(input.coverage.startDate, input.coverage.endDateExclusive)) {
    return unavailable("invalid_coverage", "Период расписания задан неполно или неверно.");
  }

  const warnings: ScheduleWarning[] = [...(input.extraWarnings ?? [])];
  const prepared: PreparedRecord[] = [];
  let blockedRows = 0;

  input.records.forEach((record, index) => {
    const outcome = prepareRecord(record, index, input.timeZone, input.groupName);
    warnings.push(...outcome.warnings);
    if (outcome.kind === "blocked") {
      blockedRows += 1;
      return;
    }
    prepared.push(outcome.record);
  });

  const duplicateRows = duplicateSourceRows(prepared);
  for (const rowNumber of new Set([...duplicateRows].map((index) => index + 1))) {
    warnings.push({
      code: "duplicate_source_id",
      message: `Строка ${rowNumber}: повторяется идентификатор занятия. Строка не включена.`,
      rowNumber,
    });
  }

  const ambiguousRows = indistinguishableRows(prepared.filter((record) => !duplicateRows.has(record.index)));
  for (const index of ambiguousRows) {
    const rowNumber = index + 1;
    warnings.push({
      code: "indistinguishable_records",
      message: `Строка ${rowNumber}: запись нельзя отличить от другой записи этого снимка. Строка не включена.`,
      rowNumber,
    });
  }

  const lessons: Lesson[] = [];
  for (const record of prepared) {
    if (duplicateRows.has(record.index) || ambiguousRows.has(record.index)) continue;
    lessons.push(await toLesson(record, input.sourceKey, input.timeZone));
  }
  lessons.sort(compareLessons);

  let coverageStatus = input.coverage.status;
  if (input.pageState === "loading") {
    warnings.push({
      code: "page_loading",
      message: "Страница ещё загружается. Период нельзя считать полным.",
    });
    coverageStatus = downgrade(coverageStatus);
  }
  if (blockedRows > 0 || duplicateRows.size > 0 || ambiguousRows.size > 0) {
    warnings.push({
      code: "rows_blocked",
      message: "Часть строк не прошла проверку и не включена в снимок. Отмены для этого снимка запрещены.",
    });
    coverageStatus = downgrade(coverageStatus);
  }

  const snapshotBase = {
    sourceKey: input.sourceKey,
    capturedAt: input.capturedAt,
    coverage: {
      startDate: input.coverage.startDate,
      endDateExclusive: input.coverage.endDateExclusive,
      timeZone: input.timeZone,
    },
    coverageStatus,
    lessons,
    warnings,
    parserVersion: input.parserVersion,
  };
  const snapshotHash = await sha256Hex(canonicalStringify(hashPayload(snapshotBase)));
  const snapshot: ScheduleSnapshot = { ...snapshotBase, snapshotHash };
  return { kind: "snapshot", snapshot };
}

function unavailable(code: string, message: string): ScheduleReadResult {
  return { kind: "unavailable", code, message, coverageStatus: "unknown" };
}

function isValidCoverage(startDate: string, endDateExclusive: string): boolean {
  return isCivilDate(startDate) && isCivilDate(endDateExclusive) && compareCivilDates(startDate, endDateExclusive) < 0;
}

function prepareRecord(
  record: RawLessonRecord,
  index: number,
  timeZone: string,
  groupName: string | undefined,
): { kind: "ready"; record: PreparedRecord; warnings: ScheduleWarning[] } | { kind: "blocked"; warnings: ScheduleWarning[] } {
  const rowNumber = index + 1;
  const warnings: ScheduleWarning[] = [];
  const title = clean(record.title);
  const date = clean(record.date);
  const startTime = clean(record.startTime);
  const endTime = clean(record.endTime);

  if (!title) {
    return blocked(rowNumber, "missing_title", `Строка ${rowNumber}: нет названия дисциплины.`);
  }
  if (!date || !isCivilDate(date)) {
    return blocked(
      rowNumber,
      "ambiguous_date",
      `Строка ${rowNumber}: дата неполная или неоднозначная. Год и календарная дата не угадываются.`,
    );
  }
  if (!startTime || !endTime || !isClockTime(startTime) || !isClockTime(endTime)) {
    return blocked(rowNumber, "missing_time", `Строка ${rowNumber}: нет времени начала или окончания.`);
  }

  const start = localDateTimeToRfc3339(date, startTime, timeZone);
  if (!start.ok) return blocked(rowNumber, start.code, localTimeMessage(rowNumber, start.code));
  const end = localDateTimeToRfc3339(date, endTime, timeZone);
  if (!end.ok) return blocked(rowNumber, end.code, localTimeMessage(rowNumber, end.code));
  if (instantOrder(start.value, end.value) >= 0) {
    return blocked(rowNumber, "invalid_time_range", `Строка ${rowNumber}: окончание не позже начала.`);
  }

  const room = clean(record.room);
  if (!room) {
    warnings.push({
      code: "missing_room",
      message: `Строка ${rowNumber}: аудитория не указана.`,
      rowNumber,
    });
  }

  const group = clean(record.group) ?? clean(groupName);
  const lessonType = clean(record.lessonType) ?? DEFAULT_LESSON_TYPE;
  const prepared: PreparedRecord = {
    index,
    rowNumber,
    title,
    sourceDate: date,
    start: start.value,
    end: end.value,
    fingerprint: canonicalStringify({
      title,
      sourceDate: date,
      start: start.value,
      end: end.value,
      room: room ?? "",
      teacher: clean(record.teacher) ?? "",
      group: group ?? "",
      lessonType,
      building: clean(record.building) ?? "",
    }),
    ...(clean(record.sourceLessonId) ? { sourceLessonId: clean(record.sourceLessonId) } : {}),
    ...(room ? { room } : {}),
    ...(clean(record.teacher) ? { teacher: clean(record.teacher) } : {}),
    ...(group ? { group } : {}),
    lessonType,
    ...(clean(record.building) ? { building: clean(record.building) } : {}),
  };
  return { kind: "ready", record: prepared, warnings };
}

function localTimeMessage(rowNumber: number, code: "invalid_date_time" | "invalid_local_time"): string {
  if (code === "invalid_local_time") {
    return `Строка ${rowNumber}: местное время пропущено или повторяется при переходе на летнее или зимнее время.`;
  }
  return `Строка ${rowNumber}: дата или время записаны неверно.`;
}

function blocked(rowNumber: number, code: string, message: string): { kind: "blocked"; warnings: ScheduleWarning[] } {
  return { kind: "blocked", warnings: [{ code, message, rowNumber }] };
}

function duplicateSourceRows(records: PreparedRecord[]): Set<number> {
  const seen = new Map<string, number[]>();
  for (const record of records) {
    if (!record.sourceLessonId) continue;
    const rows = seen.get(record.sourceLessonId) ?? [];
    rows.push(record.index);
    seen.set(record.sourceLessonId, rows);
  }
  const blockedIndexes = new Set<number>();
  for (const rows of seen.values()) {
    if (rows.length < 2) continue;
    for (const index of rows) blockedIndexes.add(index);
  }
  return blockedIndexes;
}

function indistinguishableRows(records: PreparedRecord[]): Set<number> {
  const groups = new Map<string, number[]>();
  for (const record of records) {
    if (record.sourceLessonId) continue;
    const rows = groups.get(record.fingerprint) ?? [];
    rows.push(record.index);
    groups.set(record.fingerprint, rows);
  }
  const blockedIndexes = new Set<number>();
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    for (const index of rows) blockedIndexes.add(index);
  }
  return blockedIndexes;
}

async function toLesson(record: PreparedRecord, sourceKey: string, timeZone: string): Promise<Lesson> {
  const stable = Boolean(record.sourceLessonId);
  const identitySource = stable
    ? canonicalStringify({ sourceKey, sourceLessonId: record.sourceLessonId })
    : canonicalStringify({ sourceKey, fingerprint: record.fingerprint });
  const localIdentity = `${stable ? "stable" : "provisional"}:${await sha256Hex(identitySource)}`;
  return {
    ...(record.sourceLessonId ? { sourceLessonId: record.sourceLessonId } : {}),
    localIdentity,
    title: record.title,
    start: record.start,
    end: record.end,
    timeZone,
    ...(record.room ? { room: record.room } : {}),
    ...(record.teacher ? { teacher: record.teacher } : {}),
    ...(record.group ? { group: record.group } : {}),
    ...(record.lessonType ? { lessonType: record.lessonType } : {}),
    ...(record.building ? { building: record.building } : {}),
    sourceDate: record.sourceDate,
    identityConfidence: stable ? "stable" : "ambiguous",
  };
}

function compareLessons(left: Lesson, right: Lesson): number {
  if (left.sourceDate !== right.sourceDate) return left.sourceDate < right.sourceDate ? -1 : 1;
  if (left.start !== right.start) return left.start < right.start ? -1 : 1;
  if (left.localIdentity !== right.localIdentity) return left.localIdentity < right.localIdentity ? -1 : 1;
  return 0;
}

function downgrade(status: CoverageStatus): CoverageStatus {
  return status === "complete" ? "partial" : status;
}

function hashPayload(snapshot: Omit<ScheduleSnapshot, "snapshotHash" | "capturedAt">): unknown {
  return {
    sourceKey: snapshot.sourceKey,
    parserVersion: snapshot.parserVersion,
    coverage: snapshot.coverage,
    coverageStatus: snapshot.coverageStatus,
    lessons: snapshot.lessons,
    warnings: snapshot.warnings.map((warning) => ({
      code: warning.code,
      rowNumber: warning.rowNumber ?? null,
      sourceLessonId: warning.sourceLessonId ?? null,
    })),
  };
}

function clean(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export const missingRoomLabel = MISSING_ROOM_LABEL;
