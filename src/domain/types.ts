export type IdentityConfidence = "stable" | "confirmed" | "ambiguous";

export type CoverageStatus = "complete" | "partial" | "unknown";

export type AppStatus =
  | "not_configured"
  | "ready"
  | "reading"
  | "review_required"
  | "syncing"
  | "partial_success"
  | "success"
  | "source_unavailable"
  | "auth_required"
  | "error";

export interface Lesson {
  sourceLessonId?: string;
  localIdentity: string;
  title: string;
  start: string;
  end: string;
  timeZone: string;
  room?: string;
  teacher?: string;
  group?: string;
  lessonType?: string;
  building?: string;
  sourceDate: string;
  identityConfidence: IdentityConfidence;
}

export interface ScheduleWarning {
  code: string;
  message: string;
  rowNumber?: number;
  sourceLessonId?: string;
}

export interface ScheduleCoverage {
  startDate: string;
  endDateExclusive: string;
  timeZone: string;
}

export interface ScheduleSnapshot {
  sourceKey: string;
  capturedAt: string;
  coverage: ScheduleCoverage;
  coverageStatus: CoverageStatus;
  lessons: Lesson[];
  warnings: ScheduleWarning[];
  parserVersion: string;
  snapshotHash: string;
}

export interface RawLessonRecord {
  sourceLessonId?: string;
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  room?: string;
  teacher?: string;
  group?: string;
  lessonType?: string;
  building?: string;
}

export type PageState = "ready" | "loading" | "logged_out" | "not_configured";

export interface NormalizeInput {
  sourceKey: string;
  parserVersion: string;
  timeZone: string;
  capturedAt: string;
  pageState: PageState;
  coverage: {
    startDate: string;
    endDateExclusive: string;
    status: CoverageStatus;
  };
  records: RawLessonRecord[];
  extraWarnings?: ScheduleWarning[];
  groupName?: string;
}

export type ScheduleReadResult =
  | { kind: "snapshot"; snapshot: ScheduleSnapshot }
  | {
      kind: "unavailable";
      code: string;
      message: string;
      coverageStatus: "unknown";
    };

export type ThemeId = "light" | "dark" | "yellow";

export interface AppSettings {
  timeZone: string;
  profileLabel: string;
  groupName: string;
  sourceOrigin: string;
  sourcePathPrefix: string;
  openCalendarAfterWrite: boolean;
  calendarColorId: string;
  theme: ThemeId;
}

export interface LessonMapping {
  lessonKey: string;
  eventId: string;
  sourceHash: string;
  managedHash: string;
}

export interface SyncJournalEntry {
  operationId: string;
  lessonKey: string;
  eventId: string;
  action: "create" | "update" | "cancel";
  state: "reserved" | "done" | "failed" | "conflict";
  snapshotHash: string;
}

export interface LastRead {
  code: string;
  message: string;
  at: string;
}

export interface TestEventRecord {
  snapshotHash: string;
  lessonKey: string;
  eventId: string;
  calendarId: string;
  done: boolean;
}

export interface AppState {
  settings: AppSettings;
  lastCheckAt: string | null;
  lastSuccessfulWriteAt: string | null;
  lastSnapshot: ScheduleSnapshot | null;
  lastRead: LastRead | null;
  lastPreviewFixtureId: string | null;
  googleCalendarId: string | null;
  googleConnected: boolean;
  calendarListReady: boolean;
  lessonColorsReleased: boolean;
  testEvent: TestEventRecord | null;
  lessonMappings: LessonMapping[];
  syncJournal: SyncJournalEntry[];
}
