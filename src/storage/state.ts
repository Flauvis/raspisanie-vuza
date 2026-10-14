import { DEFAULT_SETTINGS } from "../domain/settings";
import { isCalendarColorId } from "../calendar/colors";
import type { AppState, Lesson, LessonMapping, ScheduleSnapshot, ScheduleWarning, SyncJournalEntry } from "../domain/types";

export const STATE_STORAGE_KEY = "ucs.state.v1";

export function defaultAppState(): AppState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    lastCheckAt: null,
    lastSuccessfulWriteAt: null,
    lastSnapshot: null,
    lastRead: null,
    lastPreviewFixtureId: null,
    googleCalendarId: null,
    googleConnected: false,
    calendarListReady: false,
    lessonColorsReleased: false,
    testEvent: null,
    lessonMappings: [],
    syncJournal: [],
  };
}

export interface StateStore {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
}

export function createMemoryStore(initial: AppState = defaultAppState()): StateStore & { snapshot(): AppState } {
  let state = cloneState(initial);
  return {
    async load() {
      return cloneState(state);
    },
    async save(next) {
      state = cloneState(next);
    },
    snapshot() {
      return cloneState(state);
    },
  };
}

export function parseAppState(value: unknown): AppState {
  const fallback = defaultAppState();
  if (!value || typeof value !== "object") return fallback;
  const source = value as Record<string, unknown>;
  const settings = parseSettings(source.settings) ?? fallback.settings;
  return {
    settings,
    lastCheckAt: optionalInstant(source.lastCheckAt),
    lastSuccessfulWriteAt: optionalInstant(source.lastSuccessfulWriteAt),
    lastSnapshot: parseSnapshot(source.lastSnapshot),
    lastRead: parseLastRead(source.lastRead),
    lastPreviewFixtureId: optionalShortText(source.lastPreviewFixtureId, 80),
    googleCalendarId: parseCalendarId(source.googleCalendarId),
    googleConnected: source.googleConnected === true,
    calendarListReady: source.calendarListReady === true,
    lessonColorsReleased: source.lessonColorsReleased === true,
    testEvent: parseTestEvent(source.testEvent),
    lessonMappings: parseMappings(source.lessonMappings),
    syncJournal: parseJournal(source.syncJournal),
  };
}

function parseSettings(value: unknown): AppState["settings"] | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const timeZone = optionalShortText(source.timeZone, 80) ?? "";
  const profileLabel = optionalShortText(source.profileLabel, 80) ?? "";
  const groupName = optionalShortText(source.groupName, 80) ?? "";
  const sourceOrigin = optionalShortText(source.sourceOrigin, 200) ?? "";
  const sourcePathPrefix = optionalShortText(source.sourcePathPrefix, 200) ?? "";
  return {
    timeZone,
    profileLabel,
    groupName,
    sourceOrigin,
    sourcePathPrefix,
    openCalendarAfterWrite: source.openCalendarAfterWrite === true,
    calendarColorId: typeof source.calendarColorId === "string" && isCalendarColorId(source.calendarColorId) ? source.calendarColorId : "",
    theme: source.theme === "dark" || source.theme === "yellow" ? source.theme : "light",
  };
}

function parseSnapshot(value: unknown): ScheduleSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const coverage = source.coverage;
  if (!coverage || typeof coverage !== "object") return null;
  const coverageSource = coverage as Record<string, unknown>;
  if (
    typeof source.sourceKey !== "string" ||
    typeof source.capturedAt !== "string" ||
    typeof source.parserVersion !== "string" ||
    typeof source.snapshotHash !== "string" ||
    (source.coverageStatus !== "complete" && source.coverageStatus !== "partial" && source.coverageStatus !== "unknown") ||
    typeof coverageSource.startDate !== "string" ||
    typeof coverageSource.endDateExclusive !== "string" ||
    typeof coverageSource.timeZone !== "string" ||
    !Array.isArray(source.lessons) ||
    !Array.isArray(source.warnings)
  ) {
    return null;
  }
  const lessons = source.lessons.every(isLesson) ? source.lessons : null;
  const warnings = source.warnings.every(isWarning) ? source.warnings : null;
  if (!lessons || !warnings) return null;
  return {
    sourceKey: source.sourceKey,
    capturedAt: source.capturedAt,
    coverage: {
      startDate: coverageSource.startDate,
      endDateExclusive: coverageSource.endDateExclusive,
      timeZone: coverageSource.timeZone,
    },
    coverageStatus: source.coverageStatus,
    lessons,
    warnings,
    parserVersion: source.parserVersion,
    snapshotHash: source.snapshotHash,
  };
}

function isLesson(value: unknown): value is Lesson {
  if (!value || typeof value !== "object") return false;
  const lesson = value as Record<string, unknown>;
  return (
    typeof lesson.localIdentity === "string" &&
    typeof lesson.title === "string" &&
    typeof lesson.start === "string" &&
    typeof lesson.end === "string" &&
    typeof lesson.timeZone === "string" &&
    typeof lesson.sourceDate === "string" &&
    (lesson.identityConfidence === "stable" ||
      lesson.identityConfidence === "confirmed" ||
      lesson.identityConfidence === "ambiguous")
  );
}

function isWarning(value: unknown): value is ScheduleWarning {
  if (!value || typeof value !== "object") return false;
  const warning = value as Record<string, unknown>;
  return typeof warning.code === "string" && typeof warning.message === "string";
}

function parseLastRead(value: unknown): AppState["lastRead"] {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (typeof source.code !== "string" || typeof source.message !== "string" || typeof source.at !== "string") return null;
  return { code: source.code, message: source.message, at: source.at };
}

function parseCalendarId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /\s|:\/\//.test(trimmed)) return null;
  return trimmed;
}

function parseMappings(value: unknown): LessonMapping[] {
  if (!Array.isArray(value)) return [];
  const result: LessonMapping[] = [];
  for (const item of value) {
    if (result.length >= 2000 || !item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const lessonKey = typeof source.lessonKey === "string" ? source.lessonKey : "";
    const eventId = typeof source.eventId === "string" ? source.eventId : "";
    const sourceHash = typeof source.sourceHash === "string" ? source.sourceHash : "";
    const managedHash = typeof source.managedHash === "string" ? source.managedHash : "";
    if (!/^(stable|provisional):[a-f0-9]{64}$/.test(lessonKey)) continue;
    if (!/^[0-9a-v]{5,128}$/.test(eventId)) continue;
    if (!/^[a-f0-9]{64}$/.test(sourceHash) || !/^[a-f0-9]{64}$/.test(managedHash)) continue;
    result.push({ lessonKey, eventId, sourceHash, managedHash });
  }
  return result;
}

function parseJournal(value: unknown): SyncJournalEntry[] {
  if (!Array.isArray(value)) return [];
  const result: SyncJournalEntry[] = [];
  for (const item of value) {
    if (result.length >= 500 || !item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const operationId = typeof source.operationId === "string" ? source.operationId : "";
    const lessonKey = typeof source.lessonKey === "string" ? source.lessonKey : "";
    const eventId = typeof source.eventId === "string" ? source.eventId : "";
    const action = source.action === "create" || source.action === "update" || source.action === "cancel" ? source.action : null;
    const state = source.state === "reserved" || source.state === "done" || source.state === "failed" || source.state === "conflict" ? source.state : null;
    const snapshotHash = typeof source.snapshotHash === "string" ? source.snapshotHash : "";
    if (!/^[0-9a-v]{5,128}$/.test(operationId)) continue;
    if (!/^(stable|provisional):[a-f0-9]{64}$/.test(lessonKey)) continue;
    if (!/^[0-9a-v]{5,128}$/.test(eventId)) continue;
    if (!action || !state || !/^[a-f0-9]{64}$/.test(snapshotHash)) continue;
    result.push({ operationId, lessonKey, eventId, action, state, snapshotHash });
  }
  return result;
}

function parseTestEvent(value: unknown): AppState["testEvent"] {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const snapshotHash = typeof source.snapshotHash === "string" ? source.snapshotHash : "";
  const lessonKey = typeof source.lessonKey === "string" ? source.lessonKey : "";
  const eventId = typeof source.eventId === "string" ? source.eventId : "";
  const calendarId = parseCalendarId(source.calendarId) ?? "";
  if (!/^[a-f0-9]{64}$/.test(snapshotHash)) return null;
  if (!/^(stable|provisional):[a-f0-9]{64}$/.test(lessonKey)) return null;
  if (!/^[0-9a-v]{5,128}$/.test(eventId)) return null;
  if (typeof source.done !== "boolean") return null;
  return { snapshotHash, lessonKey, eventId, calendarId, done: source.done };
}

function optionalInstant(value: unknown): string | null {
  return typeof value === "string" && value.length <= 40 ? value : null;
}

function optionalShortText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function cloneState(state: AppState): AppState {
  return structuredClone(state);
}
