import { sha256Hex, canonicalStringify } from "../domain/canonical";
import type { AppState, Lesson, ScheduleSnapshot, TestEventRecord } from "../domain/types";
import { calendarEventDraft } from "./writes";

export const CALENDAR_SUMMARY = "Расписание вуза";
export const APP_NAME = "university-calendar-sync";

export interface GoogleEventBody {
  id: string;
  summary: string;
  location?: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: Record<string, string> };
}

export interface ListedCalendar {
  id: string;
  summary: string;
  primary?: boolean;
}

export interface OwnedEvent {
  id: string;
  etag: string;
  summary: string;
  location: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
  lessonKey: string;
  sourceKey: string;
  sourceHash: string;
}

export interface CalendarApi {
  hasSession(): Promise<boolean>;
  listCalendars(): Promise<{ ok: true; calendars: ListedCalendar[] } | { ok: false; code: "auth" | "forbidden" | "error" | "scope" }>;
  getCalendar(id: string): Promise<"ok" | "missing" | "auth" | "forbidden" | "error">;
  createCalendar(summary: string): Promise<{ ok: true; id: string } | { ok: false; code: "auth" | "forbidden" | "error" }>;
  setCalendarColor(id: string, colorId: string): Promise<{ ok: true } | { ok: false; code: "auth" | "forbidden" | "scope" | "error"; status: number }>;
  releaseLessonColors(id: string): Promise<{ ok: true } | { ok: false; code: "auth" | "forbidden" | "scope" | "error"; status: number }>;
  deleteCalendar(id: string): Promise<{ ok: true } | { ok: false; code: "missing" | "auth" | "forbidden" | "error"; status: number }>;
  deleteEvent(calendarId: string, eventId: string, etag: string): Promise<{ ok: true } | { ok: false; code: "missing" | "conflict" | "auth" | "forbidden" | "error" }>;
  getEvent(calendarId: string, eventId: string): Promise<{ ok: true; body: unknown } | { ok: false; code: "missing" | "auth" | "error" }>;
  insertEvent(calendarId: string, body: GoogleEventBody): Promise<{ ok: true } | { ok: false; status: number; code: "conflict" | "auth" | "forbidden" | "error" }>;
  patchEvent(calendarId: string, eventId: string, body: Omit<GoogleEventBody, "id">, etag: string): Promise<{ ok: true } | { ok: false; code: "conflict" | "auth" | "forbidden" | "error" }>;
  listOwnedEvents(calendarId: string): Promise<{ ok: true; events: OwnedEvent[] } | { ok: false; code: "auth" | "forbidden" | "error" }>;
  hasAppEvents(calendarId: string): Promise<{ ok: true; found: boolean } | { ok: false; code: "auth" | "forbidden" | "error" }>;
}

export interface PlannedTestLesson {
  snapshotHash: string;
  sourceKey: string;
  lessonKey: string;
  title: string;
  start: string;
  end: string;
  timeZone: string;
  summary: string;
  location: string;
  description: string;
  sourceHash: string;
}

export function earliestLesson(snapshot: ScheduleSnapshot): Lesson | undefined {
  return snapshot.lessons[0];
}

export async function sourceHashForLesson(lesson: Lesson): Promise<string> {
  return sha256Hex(
    canonicalStringify({
      title: lesson.title,
      start: lesson.start,
      end: lesson.end,
      timeZone: lesson.timeZone,
      room: lesson.room ?? "",
      teacher: lesson.teacher ?? "",
      group: lesson.group ?? "",
    }),
  );
}

export async function planLesson(snapshot: ScheduleSnapshot, lesson: Lesson): Promise<PlannedTestLesson> {
  const draft = calendarEventDraft(lesson);
  return {
    snapshotHash: snapshot.snapshotHash,
    sourceKey: snapshot.sourceKey,
    lessonKey: lesson.localIdentity,
    title: lesson.title,
    start: lesson.start,
    end: lesson.end,
    timeZone: lesson.timeZone,
    summary: draft.summary,
    location: draft.location,
    description: draft.description,
    sourceHash: await sourceHashForLesson(lesson),
  };
}

export async function planTestLesson(snapshot: ScheduleSnapshot): Promise<PlannedTestLesson | null> {
  const lesson = earliestLesson(snapshot);
  if (!lesson) return null;
  return planLesson(snapshot, lesson);
}

export function eventBody(plan: PlannedTestLesson, eventId: string): GoogleEventBody {
  return {
    id: eventId,
    summary: plan.summary,
    ...(plan.location ? { location: plan.location } : {}),
    ...(plan.description ? { description: plan.description } : {}),
    start: { dateTime: plan.start, timeZone: plan.timeZone },
    end: { dateTime: plan.end, timeZone: plan.timeZone },
    extendedProperties: {
      private: {
        app: APP_NAME,
        schemaVersion: "1",
        sourceKey: plan.sourceKey,
        lessonKey: plan.lessonKey,
        sourceHash: plan.sourceHash,
      },
    },
  };
}

export function eventMatchesPlan(body: unknown, plan: PlannedTestLesson): boolean {
  if (!body || typeof body !== "object") return false;
  const props = (body as { extendedProperties?: { private?: Record<string, unknown> } }).extendedProperties?.private;
  if (!props) return false;
  return props.app === APP_NAME && props.sourceKey === plan.sourceKey && props.lessonKey === plan.lessonKey && props.sourceHash === plan.sourceHash;
}

export async function runConfirmedTestWrite(args: {
  state: AppState;
  snapshotHash: string;
  createCalendar: boolean;
  now: string;
  newEventId: string | null;
  api: CalendarApi;
  save: (state: AppState) => Promise<void>;
}): Promise<{ state: AppState; ok: boolean; code: string; message: string }> {
  const snapshot = args.state.lastSnapshot;
  if (!snapshot || snapshot.snapshotHash !== args.snapshotHash) {
    return done(args.state, false, "snapshot_changed", "Снимок изменился. Откройте предпросмотр ещё раз и подтвердите ту же пару.");
  }
  const plan = await planTestLesson(snapshot);
  if (!plan) return done(args.state, false, "no_lesson", "В снимке нет занятия для тестовой записи.");

  const existing = args.state.testEvent;
  if (existing?.done && existing.snapshotHash === plan.snapshotHash && existing.lessonKey === plan.lessonKey) {
    return done(args.state, true, "already_written", "Эта тестовая пара уже записана. Вторая копия не создаётся.");
  }
  if (!args.newEventId && !(existing && existing.lessonKey === plan.lessonKey && existing.snapshotHash === plan.snapshotHash)) {
    return done(args.state, false, "event_id_invalid", "Не удалось зарезервировать идентификатор события.");
  }
  const eventId = existing && existing.lessonKey === plan.lessonKey && existing.snapshotHash === plan.snapshotHash ? existing.eventId : args.newEventId;
  if (!eventId) return done(args.state, false, "event_id_invalid", "Не удалось зарезервировать идентификатор события.");

  const calendar = await ensureCalendar(args, plan, eventId);
  if (!calendar.ok) return calendar;
  const reserved = withReservation(calendar.state, plan, eventId, calendar.calendarId, false, args.now);
  await args.save(reserved);
  const body = eventBody(plan, eventId);
  const inserted = await args.api.insertEvent(calendar.calendarId, body);
  if (!inserted.ok && inserted.code === "conflict") {
    const found = await args.api.getEvent(calendar.calendarId, eventId);
    if (found.ok && eventMatchesPlan(found.body, plan)) return finish(args, reserved, plan, eventId, calendar.calendarId);
    return done(calendar.state, false, "event_conflict", "Событие с этим идентификатором уже есть и не принадлежит этой паре. Новая копия не создаётся.");
  }
  if (!inserted.ok && inserted.code === "auth") return done(reserved, false, "auth_required", "Нужно снова подключить Google. Событие не создано.");
  if (!inserted.ok && inserted.code === "forbidden") return done(reserved, false, "google_forbidden", "Google отказал в доступе. Это не истёкший вход. Событие не создано.");
  if (!inserted.ok) return done(reserved, false, "google_error", "Google не подтвердил запись. Повтор использует тот же идентификатор события.");
  return finish(args, reserved, plan, eventId, calendar.calendarId);
}

async function ensureCalendar(
  args: { state: AppState; createCalendar: boolean; now: string; api: CalendarApi; save: (state: AppState) => Promise<void> },
  plan: PlannedTestLesson,
  eventId: string,
): Promise<{ ok: true; calendarId: string; state: AppState } | { ok: false; state: AppState; code: string; message: string }> {
  const savedId = args.state.googleCalendarId;
  if (savedId) {
    const found = await args.api.getCalendar(savedId);
    if (found === "ok") {
      if (args.state.settings.calendarColorId) await args.api.setCalendarColor(savedId, args.state.settings.calendarColorId);
      return { ok: true, calendarId: savedId, state: args.state };
    }
    if (found === "auth") return { ok: false, state: args.state, code: "auth_required", message: "Нужно снова подключить Google." };
    if (found === "forbidden") return { ok: false, state: args.state, code: "google_forbidden", message: "Google отказал в доступе к сохранённому календарю." };
    if (found === "missing" && !args.createCalendar) {
      return { ok: false, state: args.state, code: "calendar_missing", message: "Сохранённый календарь не найден. Он не заменяется календарём с тем же названием. Подтвердите создание нового." };
    }
    if (found !== "missing") return { ok: false, state: args.state, code: "google_error", message: "Не удалось проверить сохранённый календарь. Новый календарь не создаётся." };
  } else if (!args.createCalendar) {
    return { ok: false, state: args.state, code: "calendar_required", message: "Календарь приложения ещё не создан. Подтвердите его создание вместе с одной парой." };
  }

  const created = await args.api.createCalendar(CALENDAR_SUMMARY);
  if (!created.ok) {
    const code = created.code === "auth" ? "auth_required" : created.code === "forbidden" ? "google_forbidden" : "google_error";
    const message = code === "auth_required" ? "Нужно снова подключить Google. Календарь не создан." : "Календарь не создан.";
    return { ok: false, state: args.state, code, message };
  }
  if (args.state.settings.calendarColorId) await args.api.setCalendarColor(created.id, args.state.settings.calendarColorId);
  const next = withReservation(args.state, plan, eventId, created.id, false, args.now);
  await args.save(next);
  return { ok: true, calendarId: created.id, state: next };
}

async function finish(
  args: { now: string; save: (state: AppState) => Promise<void> },
  state: AppState,
  plan: PlannedTestLesson,
  eventId: string,
  calendarId: string,
): Promise<{ state: AppState; ok: boolean; code: string; message: string }> {
  const next = withReservation(state, plan, eventId, calendarId, true, args.now);
  await args.save(next);
  return { state: next, ok: true, code: "test_event_written", message: "Создана одна тестовая пара. Остальные занятия не записывались." };
}

function withReservation(state: AppState, plan: PlannedTestLesson, eventId: string, calendarId: string, done: boolean, now: string): AppState {
  const testEvent: TestEventRecord = {
    snapshotHash: plan.snapshotHash,
    lessonKey: plan.lessonKey,
    eventId,
    calendarId,
    done,
  };
  return {
    ...state,
    googleCalendarId: calendarId,
    testEvent,
    lastSuccessfulWriteAt: done ? now : state.lastSuccessfulWriteAt,
    lastRead: { code: done ? "test_event_written" : "test_event_reserved", message: done ? "Тестовая пара записана." : "Идентификатор события зарезервирован.", at: now },
  };
}

function done(state: AppState, ok: boolean, code: string, message: string): { state: AppState; ok: boolean; code: string; message: string } {
  return { state, ok, code, message };
}
