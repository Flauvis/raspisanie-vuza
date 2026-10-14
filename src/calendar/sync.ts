import { sha256Hex, canonicalStringify } from "../domain/canonical";
import { civilDateInZone, compareCivilDates, instantOrder } from "../domain/time";
import type { AppState, LessonMapping, ScheduleSnapshot, SyncJournalEntry } from "../domain/types";
import { lessonEventId } from "./event-id";
import { selectRecoverableCalendars, type RecoverableCalendar } from "./recover";
import { CALENDAR_SUMMARY, eventBody, planLesson, type CalendarApi, type OwnedEvent, type PlannedTestLesson } from "./test-write";

export interface SyncCounts {
  create: number;
  update: number;
  unchanged: number;
  conflict: number;
  cancel: number;
}

export type SyncItem =
  | {
      action: "create" | "update" | "unchanged" | "conflict";
      lessonKey: string;
      eventId: string;
      etag: string;
      plan: PlannedTestLesson;
    }
  | {
      action: "cancel";
      lessonKey: string;
      eventId: string;
      etag: string;
    };

export async function calendarsWithAppEvents(api: CalendarApi): Promise<
  | { ok: true; calendars: RecoverableCalendar[] }
  | { ok: false; code: "auth" | "forbidden" | "error" | "scope" }
> {
  const listed = await api.listCalendars();
  if (!listed.ok) return { ok: false, code: listed.code };
  const counts = new Map<string, number>();
  for (const calendar of listed.calendars) {
    if (calendar.primary === true || !calendar.id || calendar.id.includes("://")) continue;
    const probe = await api.hasAppEvents(calendar.id);
    if (!probe.ok) {
      if (probe.code === "auth") return { ok: false, code: "auth" };
      continue;
    }
    counts.set(calendar.id, probe.found ? 1 : 0);
  }
  return { ok: true, calendars: selectRecoverableCalendars(listed.calendars, counts).filter((item) => item.hasAppEvents) };
}

export async function rememberExistingCalendar(args: {
  state: AppState;
  api: CalendarApi;
  save: (state: AppState) => Promise<void>;
}): Promise<
  | { ok: true; state: AppState }
  | { ok: false; code: "several_calendars" | "auth_required" | "google_forbidden" | "google_error"; message: string }
> {
  if (args.state.googleCalendarId) return { ok: true, state: args.state };
  const found = await calendarsWithAppEvents(args.api);
  if (!found.ok) {
    const code = found.code === "auth" ? "auth_required" : found.code === "forbidden" || found.code === "scope" ? "google_forbidden" : "google_error";
    return { ok: false, code, message: "Не удалось проверить уже существующие календари. Новый календарь не создан." };
  }
  if (found.calendars.length > 1) {
    return {
      ok: false,
      code: "several_calendars",
      message: "Найдено несколько календарей с парами этого расширения. Новый календарь не создан и пары заново не записаны. В настройках кнопка «Удалить календарь» удаляет только календарь, который запомнило это расширение.",
    };
  }
  const existing = found.calendars[0];
  if (!existing) return { ok: true, state: args.state };
  const next = { ...args.state, googleCalendarId: existing.id };
  await args.save(next);
  return { ok: true, state: next };
}

export async function buildSyncPlan(snapshot: ScheduleSnapshot, events: OwnedEvent[], mappings: LessonMapping[]): Promise<SyncItem[]> {
  const byLesson = new Map<string, OwnedEvent>();
  for (const event of events) {
    if (event.sourceKey !== snapshot.sourceKey) continue;
    if (!byLesson.has(event.lessonKey)) byLesson.set(event.lessonKey, event);
  }
  const byMapping = new Map(mappings.map((item) => [item.lessonKey, item]));
  const items: SyncItem[] = [];
  for (const lesson of snapshot.lessons) {
    const plan = await planLesson(snapshot, lesson);
    const event = byLesson.get(lesson.localIdentity);
    const eventId = event?.id ?? (await lessonEventId(lesson.localIdentity));
    if (!event) {
      items.push({ action: "create", lessonKey: lesson.localIdentity, eventId, etag: "", plan });
      continue;
    }
    if (await sameManaged(event, plan)) {
      items.push({ action: "unchanged", lessonKey: lesson.localIdentity, eventId: event.id, etag: event.etag, plan });
      continue;
    }
    const mapping = byMapping.get(lesson.localIdentity);
    const currentManaged = await managedHash({
      summary: event.summary,
      location: event.location,
      description: event.description,
      start: event.start,
      end: event.end,
      timeZone: event.timeZone || plan.timeZone,
    });
    const userEdited = mapping ? mapping.managedHash !== currentManaged : event.sourceHash === plan.sourceHash;
    items.push({
      action: userEdited ? "conflict" : "update",
      lessonKey: lesson.localIdentity,
      eventId: event.id,
      etag: event.etag,
      plan,
    });
  }
  items.push(...cancellationItems(snapshot, events, mappings));
  return items;
}

export function countSync(items: SyncItem[]): SyncCounts {
  return {
    create: items.filter((item) => item.action === "create").length,
    update: items.filter((item) => item.action === "update").length,
    unchanged: items.filter((item) => item.action === "unchanged").length,
    conflict: items.filter((item) => item.action === "conflict").length,
    cancel: items.filter((item) => item.action === "cancel").length,
  };
}

export function describeSyncPlan(counts: SyncCounts, createCalendar: boolean): string {
  const calendar = createCalendar ? "Будет создан новый календарь. " : "";
  const cancellations = counts.cancel > 0
    ? ` К отмене после отдельного подтверждения: ${counts.cancel}.`
    : " Удалений нет.";
  return `${calendar}К записи: создать ${counts.create}, обновить ${counts.update}. Без изменений: ${counts.unchanged}. Спорных, их календарь не перезапишет: ${counts.conflict}.${cancellations}`;
}

export async function runConfirmedSync(args: {
  state: AppState;
  snapshotHash: string;
  now: string;
  api: CalendarApi;
  save: (state: AppState) => Promise<void>;
  newOperationId: () => string;
}): Promise<{ state: AppState; ok: boolean; code: string; message: string }> {
  const snapshot = args.state.lastSnapshot;
  if (!snapshot || snapshot.snapshotHash !== args.snapshotHash) {
    return { state: args.state, ok: false, code: "snapshot_changed", message: "Снимок изменился. Сравните расписание ещё раз и подтвердите тот же список." };
  }
  if (snapshot.lessons.length === 0) {
    return { state: args.state, ok: false, code: "no_lesson", message: "В снимке нет занятий. В календарь ничего не отправлено." };
  }
  const remembered = await rememberExistingCalendar({ state: args.state, api: args.api, save: args.save });
  if (!remembered.ok) return { state: args.state, ok: false, code: remembered.code, message: remembered.message };
  const calendar = await ensureSyncCalendar({ ...args, state: remembered.state });
  if (!calendar.ok) return calendar;
  const listed = await args.api.listOwnedEvents(calendar.calendarId);
  if (!listed.ok) {
    const code = listed.code === "auth" ? "auth_required" : listed.code === "forbidden" ? "google_forbidden" : "google_error";
    const message = code === "auth_required" ? "Нужно снова подключить Google. Запись не начата." : "Не удалось прочитать события календаря. Запись не начата.";
    return { state: calendar.state, ok: false, code, message };
  }
  const items = await buildSyncPlan(snapshot, listed.events, calendar.state.lessonMappings);
  const counts = countSync(items);
  if (counts.create === 0 && counts.update === 0) {
    const pending = counts.cancel > 0 ? ` К отмене после отдельного подтверждения: ${counts.cancel}.` : " Удалений нет.";
    const message = counts.conflict > 0
      ? `Спорные пары оставлены как в календаре: ${counts.conflict}. Остальные уже совпадают.${pending}`
      : `Все пары уже совпадают с календарём. Новых записей нет.${pending}`;
    return { state: calendar.state, ok: true, code: "sync_unchanged", message };
  }
  let state = calendar.state;
  const done = { create: 0, update: 0, conflict: counts.conflict, failed: 0 };
  const journal: SyncJournalEntry[] = [];
  for (const item of items) {
    if (item.action !== "create" && item.action !== "update") continue;
    const operationId = args.newOperationId();
    journal.push({
      operationId,
      lessonKey: item.lessonKey,
      eventId: item.eventId,
      action: item.action,
      state: "reserved",
      snapshotHash: snapshot.snapshotHash,
    });
    state = { ...state, syncJournal: journal };
    await args.save(state);
    const result = await writeItem(args.api, calendar.calendarId, item);
    const entry = journal[journal.length - 1];
    if (!entry) continue;
    if (result === "done") {
      entry.state = "done";
      done[item.action] += 1;
      state = await rememberMapping(state, item);
      state = { ...state, syncJournal: journal, lastSuccessfulWriteAt: args.now };
    } else if (result === "conflict") {
      entry.state = "conflict";
      done.conflict += 1;
      state = { ...state, syncJournal: journal };
    } else {
      entry.state = "failed";
      done.failed += 1;
      state = { ...state, syncJournal: journal };
      await args.save(state);
      return {
        state,
        ok: false,
        code: result === "auth" ? "auth_required" : "sync_partial",
        message: `Запись прервана. Создано ${done.create}, обновлено ${done.update}. Остальные пары не отправлялись.`,
      };
    }
    await args.save(state);
  }
  const code = counts.conflict > 0 || done.conflict > counts.conflict ? "sync_partial" : "sync_written";
  const pending = counts.cancel > 0
    ? ` Отмен не выполнено: ${counts.cancel}. Их удаляет только отдельное подтверждение.`
    : " Удалений нет.";
  return {
    state,
    ok: true,
    code,
    message: `Записано. Создано ${done.create}, обновлено ${done.update}. Спорных пар не перезаписано: ${done.conflict}.${pending}`,
  };
}

async function ensureSyncCalendar(args: {
  state: AppState;
  api: CalendarApi;
  save: (state: AppState) => Promise<void>;
  now: string;
}): Promise<{ ok: true; calendarId: string; state: AppState } | { ok: false; state: AppState; code: string; message: string }> {
  const savedId = args.state.googleCalendarId;
  if (savedId) {
    const found = await args.api.getCalendar(savedId);
    if (found === "ok") {
      if (args.state.settings.calendarColorId) await args.api.setCalendarColor(savedId, args.state.settings.calendarColorId);
      return { ok: true, calendarId: savedId, state: args.state };
    }
    if (found === "auth") return { ok: false, state: args.state, code: "auth_required", message: "Нужно снова подключить Google." };
    if (found === "forbidden") return { ok: false, state: args.state, code: "google_forbidden", message: "Google отказал в доступе к сохранённому календарю." };
    if (found === "missing") return { ok: false, state: args.state, code: "calendar_missing", message: "Сохранённый календарь не найден. Он не заменяется календарём с тем же названием." };
    return { ok: false, state: args.state, code: "google_error", message: "Не удалось проверить сохранённый календарь. Новый календарь не создаётся." };
  }
  const created = await args.api.createCalendar(CALENDAR_SUMMARY);
  if (!created.ok) {
    const code = created.code === "auth" ? "auth_required" : created.code === "forbidden" ? "google_forbidden" : "google_error";
    return { ok: false, state: args.state, code, message: code === "auth_required" ? "Нужно снова подключить Google. Календарь не создан." : "Календарь не создан." };
  }
  if (args.state.settings.calendarColorId) await args.api.setCalendarColor(created.id, args.state.settings.calendarColorId);
  const next = { ...args.state, googleCalendarId: created.id };
  await args.save(next);
  return { ok: true, calendarId: created.id, state: next };
}

async function writeItem(api: CalendarApi, calendarId: string, item: Exclude<SyncItem, { action: "cancel" }>): Promise<"done" | "conflict" | "auth" | "failed"> {
  if (item.action === "create") {
    const inserted = await api.insertEvent(calendarId, eventBody(item.plan, item.eventId));
    if (inserted.ok) return "done";
    if (inserted.code === "conflict") {
      const found = await api.getEvent(calendarId, item.eventId);
      if (found.ok && eventLessonKey(found.body) === item.lessonKey) return "done";
      return "conflict";
    }
    if (inserted.code === "auth") return "auth";
    return "failed";
  }
  const full = eventBody(item.plan, item.eventId);
  const patched = await api.patchEvent(calendarId, item.eventId, {
    summary: full.summary,
    location: full.location ?? "",
    description: full.description ?? "",
    start: full.start,
    end: full.end,
    extendedProperties: full.extendedProperties,
  }, item.etag);
  if (patched.ok) return "done";
  if (patched.code === "conflict") return "conflict";
  if (patched.code === "auth") return "auth";
  return "failed";
}

async function rememberMapping(state: AppState, item: Exclude<SyncItem, { action: "cancel" }>): Promise<AppState> {
  const mapping: LessonMapping = {
    lessonKey: item.lessonKey,
    eventId: item.eventId,
    sourceHash: item.plan.sourceHash,
    managedHash: await managedHash({
      summary: item.plan.summary,
      location: item.plan.location,
      description: item.plan.description,
      start: item.plan.start,
      end: item.plan.end,
      timeZone: item.plan.timeZone,
    }),
  };
  return {
    ...state,
    lessonMappings: [...state.lessonMappings.filter((saved) => saved.lessonKey !== item.lessonKey), mapping],
  };
}

async function sameManaged(event: OwnedEvent, plan: PlannedTestLesson): Promise<boolean> {
  return event.summary === plan.summary
    && event.location === plan.location
    && event.description === plan.description
    && (event.timeZone || plan.timeZone) === plan.timeZone
    && sameInstant(event.start, plan.start)
    && sameInstant(event.end, plan.end);
}

function sameInstant(left: string, right: string): boolean {
  try {
    return instantOrder(left, right) === 0;
  } catch {
    return left === right;
  }
}

async function managedHash(event: {
  summary: string;
  location: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
}): Promise<string> {
  return sha256Hex(canonicalStringify({
    summary: event.summary,
    location: event.location,
    description: event.description,
    start: event.start,
    end: event.end,
    timeZone: event.timeZone,
  }));
}

function eventLessonKey(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const priv = (body as { extendedProperties?: { private?: { lessonKey?: unknown } } }).extendedProperties?.private;
  return typeof priv?.lessonKey === "string" ? priv.lessonKey : "";
}

export async function runConfirmedCancellations(args: {
  state: AppState;
  snapshotHash: string;
  now: string;
  api: CalendarApi;
  save: (state: AppState) => Promise<void>;
  newOperationId: () => string;
}): Promise<{ state: AppState; ok: boolean; code: string; message: string }> {
  const snapshot = args.state.lastSnapshot;
  if (!snapshot || snapshot.snapshotHash !== args.snapshotHash) {
    return { state: args.state, ok: false, code: "snapshot_changed", message: "Снимок изменился. Сравните расписание ещё раз и подтвердите те же отмены." };
  }
  if (snapshot.coverageStatus !== "complete") {
    return { state: args.state, ok: false, code: "snapshot_partial", message: "Снимок неполный. Отмены не выполняются." };
  }
  if (!args.state.googleCalendarId) {
    return { state: args.state, ok: false, code: "calendar_missing", message: "Календарь расширения ещё не создан. Отменять нечего." };
  }
  const found = await args.api.getCalendar(args.state.googleCalendarId);
  if (found !== "ok") {
    const code = found === "auth" ? "auth_required" : found === "forbidden" ? "google_forbidden" : found === "missing" ? "calendar_missing" : "google_error";
    return { state: args.state, ok: false, code, message: "Сохранённый календарь недоступен. Отмены не начаты." };
  }
  const listed = await args.api.listOwnedEvents(args.state.googleCalendarId);
  if (!listed.ok) {
    const code = listed.code === "auth" ? "auth_required" : listed.code === "forbidden" ? "google_forbidden" : "google_error";
    return { state: args.state, ok: false, code, message: "Не удалось прочитать события календаря. Отмены не начаты." };
  }
  const items = cancellationItems(snapshot, listed.events, args.state.lessonMappings);
  if (items.length === 0) {
    return { state: args.state, ok: true, code: "cancel_none", message: "Отменять нечего. В полном снимке нет пропавших пар этого календаря." };
  }
  let state = args.state;
  const journal: SyncJournalEntry[] = [];
  let removed = 0;
  let conflict = 0;
  for (const item of items) {
    const operationId = args.newOperationId();
    journal.push({
      operationId,
      lessonKey: item.lessonKey,
      eventId: item.eventId,
      action: "cancel",
      state: "reserved",
      snapshotHash: snapshot.snapshotHash,
    });
    state = { ...state, syncJournal: journal };
    await args.save(state);
    const result = await args.api.deleteEvent(args.state.googleCalendarId, item.eventId, item.etag);
    const entry = journal[journal.length - 1];
    if (!entry) continue;
    if (result.ok || result.code === "missing") {
      entry.state = "done";
      removed += 1;
      state = {
        ...state,
        syncJournal: journal,
        lessonMappings: state.lessonMappings.filter((saved) => saved.eventId !== item.eventId),
        lastSuccessfulWriteAt: args.now,
      };
    } else if (result.code === "conflict") {
      entry.state = "conflict";
      conflict += 1;
      state = { ...state, syncJournal: journal };
    } else {
      entry.state = "failed";
      state = { ...state, syncJournal: journal };
      await args.save(state);
      const code = result.code === "auth" ? "auth_required" : "sync_partial";
      return { state, ok: false, code, message: `Отмена прервана. Удалено ${removed}. Остальные пары не отправлялись.` };
    }
    await args.save(state);
  }
  return {
    state,
    ok: true,
    code: conflict > 0 ? "sync_partial" : "cancellations_written",
    message: `Удалено пар: ${removed}. Спорных не удалено: ${conflict}.`,
  };
}

function cancellationItems(snapshot: ScheduleSnapshot, events: OwnedEvent[], mappings: LessonMapping[]): Extract<SyncItem, { action: "cancel" }>[] {
  if (snapshot.coverageStatus !== "complete") return [];
  const present = new Set(snapshot.lessons.map((lesson) => lesson.localIdentity));
  const known = new Set(mappings.map((item) => item.lessonKey));
  const items: Extract<SyncItem, { action: "cancel" }>[] = [];
  for (const event of events) {
    if (event.sourceKey !== snapshot.sourceKey || present.has(event.lessonKey)) continue;
    if (!eventInCoverage(event, snapshot) && !known.has(event.lessonKey)) continue;
    items.push({ action: "cancel", lessonKey: event.lessonKey, eventId: event.id, etag: event.etag });
  }
  return items;
}

function eventInCoverage(event: OwnedEvent, snapshot: ScheduleSnapshot): boolean {
  const day = civilDateInZone(event.start, snapshot.coverage.timeZone);
  if (!day) return false;
  return compareCivilDates(day, snapshot.coverage.startDate) >= 0 && compareCivilDates(day, snapshot.coverage.endDateExclusive) < 0;
}
