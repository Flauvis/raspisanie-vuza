import { snapshotFromIbndExtract } from "../adapters/ibnd/adapter";
import { IBND_ORIGIN, IBND_TIME_ZONE, sanitizeIbndExtract, type IbndExtractResult } from "../adapters/ibnd/extract";
import { isLiveAdapterConfigured } from "../adapters/live";
import { googleEventId } from "../calendar/event-id";
import { googleCalendarUrl } from "../calendar/calendar-url";
import { buildSyncPlan, calendarsWithAppEvents, countSync, describeSyncPlan, rememberExistingCalendar, runConfirmedCancellations, runConfirmedSync } from "../calendar/sync";
import { selectRecoverableCalendars, type RecoverableCalendar } from "../calendar/recover";
import { planTestLesson, runConfirmedTestWrite, type CalendarApi } from "../calendar/test-write";
import { logTechnical } from "../domain/log";
import { evaluateReadRequest } from "../domain/read-gate";
import { validateSettings } from "../domain/settings";
import { deriveStatus, STATUS_LABELS } from "../domain/status";
import type { AppState } from "../domain/types";
import { defaultAppState, type StateStore } from "../storage/state";

export interface MessageSender {
  id?: string;
  url?: string;
}

export interface MessageDeps {
  extensionId: string;
  store: StateStore;
  getActiveTabUrl: () => Promise<string | undefined>;
  now: () => string;
  isLiveAdapterConfigured?: (url: string | undefined) => boolean;
  extractSchedule?: () => Promise<IbndExtractResult>;
  openReview?: () => Promise<void>;
  oauthConfigured?: boolean;
  authorizeInteractive?: () => Promise<boolean>;
  calendarApi?: CalendarApi;
  newEventId?: () => string | null;
  openCalendar?: (url: string) => Promise<void>;
}

const KNOWN_TYPES = new Set(["getState", "saveSettings", "clearLocalData", "readActiveTab", "connectGoogle", "dryRunGoogle", "chooseGoogleCalendar", "confirmTestEvent", "planSync", "confirmSync", "confirmCancellations", "deleteCalendar", "findAppCalendars"]);
let confirmInFlight = false;

export async function handleMessage(message: unknown, sender: MessageSender, deps: MessageDeps): Promise<unknown> {
  if (!isTrustedExtensionSender(sender, deps.extensionId)) {
    return { ok: false, code: "untrusted_sender", message: "Источник сообщения не принят." };
  }
  if (!message || typeof message !== "object") {
    return { ok: false, code: "unknown_message", message: "Сообщение не распознано." };
  }
  const type = (message as { type?: unknown }).type;
  if (typeof type !== "string" || !KNOWN_TYPES.has(type)) {
    return { ok: false, code: "unknown_message", message: "Сообщение не распознано." };
  }
  if (type === "getState") return presentState(await deps.store.load(), deps);
  if (type === "clearLocalData") {
    const current = await deps.store.load();
    const cleared = defaultAppState();
    cleared.googleCalendarId = current.googleCalendarId;
    await deps.store.save(cleared);
    return presentState(cleared, deps);
  }
  if (type === "saveSettings") {
    const parsed = validateSettings((message as { settings?: unknown }).settings);
    if (!parsed.ok) return { ok: false, code: "invalid_settings", issues: parsed.issues };
    const current = await deps.store.load();
    const next: AppState = { ...current, settings: parsed.value };
    await deps.store.save(next);
    const colorMessage = await applyCalendarColor(next, deps);
    return { ...presentState(next, deps), message: colorMessage };
  }
  if (type === "connectGoogle") return connectGoogle(deps);
  if (type === "dryRunGoogle") return dryRunGoogle(deps);
  if (type === "chooseGoogleCalendar") return chooseGoogleCalendar(message, deps);
  if (type === "confirmTestEvent") return confirmTestEvent(message, deps);
  if (type === "planSync") return planSync(deps);
  if (type === "confirmSync") return confirmSync(message, deps);
  if (type === "confirmCancellations") return confirmCancellations(message, deps);
  if (type === "findAppCalendars") return findAppCalendars(deps);
  if (type === "deleteCalendar") return deleteAppCalendar(deps, message);
  return readActiveTab(deps);
}

async function readActiveTab(deps: MessageDeps): Promise<unknown> {
  const current = await deps.store.load();
  const tabUrl = await deps.getActiveTabUrl();
  const configured = (deps.isLiveAdapterConfigured ?? isLiveAdapterConfigured)(tabUrl);
  const decision = evaluateReadRequest({
    timeZone: current.settings.timeZone,
    sourceOrigin: current.settings.sourceOrigin,
    sourcePathPrefix: current.settings.sourcePathPrefix,
    tabUrl,
    adapterConfiguredForUrl: configured,
  });
  const checkedAt = deps.now();
  if (decision.action === "block") {
    const blocked: AppState = {
      ...current,
      lastCheckAt: checkedAt,
      lastSuccessfulWriteAt: current.lastSuccessfulWriteAt,
      lastRead: { code: decision.code, message: decision.message, at: checkedAt },
    };
    await deps.store.save(blocked);
    return failure(blocked, decision.code, decision.message);
  }

  const extract = sanitizeIbndExtract(await deps.extractSchedule?.());
  const tabOrigin = originOf(tabUrl);
  const timeZone = current.settings.timeZone || (tabOrigin === IBND_ORIGIN ? IBND_TIME_ZONE : "");
  const result = await snapshotFromIbndExtract(extract, checkedAt, timeZone, current.settings.groupName);
  if (result.kind !== "snapshot") {
    const missed: AppState = {
      ...current,
      lastCheckAt: checkedAt,
      lastSuccessfulWriteAt: current.lastSuccessfulWriteAt,
      lastRead: { code: result.code, message: result.message, at: checkedAt },
    };
    await deps.store.save(missed);
    logTechnical({ code: result.code });
    return failure(missed, result.code, result.message);
  }

  const lessonCount = result.snapshot.lessons.length;
  const blockedRows = result.snapshot.warnings.some((warning) => warning.code === "rows_blocked");
  const message = blockedRows
    ? `Прочитано занятий: ${lessonCount}. Часть строк пропущена. Запись в календарь выключена.`
    : `Прочитано занятий: ${lessonCount}. Запись в календарь выключена.`;
  const next: AppState = {
    ...current,
    settings: {
      ...current.settings,
      timeZone: current.settings.timeZone || timeZone,
      sourceOrigin: current.settings.sourceOrigin || (tabOrigin === IBND_ORIGIN ? IBND_ORIGIN : ""),
    },
    lastCheckAt: checkedAt,
    lastSuccessfulWriteAt: current.lastSuccessfulWriteAt,
    lastSnapshot: result.snapshot,
    lastRead: { code: "read", message, at: checkedAt },
    lastPreviewFixtureId: "live",
  };
  await deps.store.save(next);
  logTechnical({ code: "schedule_read", count: lessonCount });
  await deps.openReview?.();
  return {
    ok: true,
    code: "read",
    message,
    status: "review_required",
    statusLabel: STATUS_LABELS.review_required,
    lessonCount,
    lastCheckAt: next.lastCheckAt,
    lastSuccessfulWriteAt: next.lastSuccessfulWriteAt,
  };
}

function failure(state: AppState, code: string, message: string): unknown {
  const status = deriveStatus(state, false);
  return {
    ok: false,
    code,
    message,
    status,
    statusLabel: STATUS_LABELS[status],
    lastCheckAt: state.lastCheckAt,
    lastSuccessfulWriteAt: state.lastSuccessfulWriteAt,
  };
}

function originOf(tabUrl: string | undefined): string {
  if (!tabUrl) return "";
  try {
    return new URL(tabUrl).origin;
  } catch {
    return "";
  }
}

function presentState(state: AppState, deps: MessageDeps): Record<string, unknown> {
  const liveReadAvailable = (deps.isLiveAdapterConfigured ?? isLiveAdapterConfigured)(state.settings.sourceOrigin || undefined);
  const status = deriveStatus(state, liveReadAvailable);
  return {
    ok: true,
    state,
    status,
    statusLabel: STATUS_LABELS[status],
    googleConnected: false,
    writesEnabled: false,
  };
}

async function connectGoogle(deps: MessageDeps): Promise<unknown> {
  if (!deps.oauthConfigured || !deps.calendarApi) {
    return { ok: false, code: "oauth_not_configured", message: "OAuth client ID ещё не вставлен в сборку. Пароль Google в расширение не вводится." };
  }
  const state = await deps.store.load();
  const signedIn = await deps.calendarApi.hasSession();
  if (!signedIn) {
    await deps.store.save({ ...state, googleConnected: false });
    return { ok: false, code: "auth_required", message: "Google не подключён. Запись не выполнялась." };
  }
  const connected = { ...state, googleConnected: true };
  await deps.store.save(connected);
  logTechnical({ code: "google_connected" });
  let message = "Google подключён. Это нажатие пары не записывает.";
  if (connected.googleCalendarId && connected.settings.calendarColorId) {
    const colorMessage = await applyCalendarColor(connected, deps);
    if (colorMessage.includes("Цвет календаря обновлён") && !colorMessage.includes("снять не удалось")) message = "Google подключён. Цвет календаря обновлён.";
    else if (colorMessage.includes("не отдал вход")) message = "Google подключён. Цвет не обновлён: Chrome не отдал вход для запроса цвета.";
    else if (colorMessage.includes("разрешить цвет")) message = "Google подключён. Нужно разрешить цвет календаря и нажать кнопку ещё раз.";
    else if (colorMessage.includes("снять не удалось")) message = "Google подключён. Цвет календаря обновлён. Прежний цвет пар снять не удалось, сохраните ещё раз.";
    else message = colorMessage.replace("Настройки сохранены.", "Google подключён.");
  }
  return {
    ok: true,
    code: "google_connected",
    message,
    calendars: [],
  };
}

async function dryRunGoogle(deps: MessageDeps): Promise<unknown> {
  const unavailable = googleUnavailable(deps);
  if (unavailable) return unavailable;
  const state = await deps.store.load();
  const plan = state.lastSnapshot ? await planTestLesson(state.lastSnapshot) : null;
  if (!plan) {
    return { ok: false, code: "no_lesson", message: "Сначала прочитайте расписание. В календарь ничего не отправлено.", calendars: [], canConfirm: false, createCalendar: false };
  }
  const createCalendar = !state.googleCalendarId;
  return {
    ok: true,
    code: "dry_run",
    message: createCalendar
      ? `Будет создан новый календарь и одна пара «${plan.title}», ${plan.start}. Остальные занятия не записываются.`
      : `В уже выбранный календарь будет записана одна пара «${plan.title}», ${plan.start}. Остальные занятия не записываются.`,
    calendars: [],
    snapshotHash: plan.snapshotHash,
    lessonTitle: plan.title,
    lessonStart: plan.start,
    lessonEnd: plan.end,
    canConfirm: true,
    createCalendar,
  };
}

async function chooseGoogleCalendar(message: unknown, deps: MessageDeps): Promise<unknown> {
  const unavailable = googleUnavailable(deps);
  if (unavailable) return unavailable;
  const api = deps.calendarApi;
  if (!api) return unavailable;
  const calendarId = message && typeof message === "object" ? (message as { calendarId?: unknown }).calendarId : undefined;
  if (typeof calendarId !== "string" || calendarId.includes("://")) {
    return { ok: false, code: "calendar_not_listed", message: "Этот календарь не выбран: его нет в списке календарей приложения." };
  }
  const listed = await api.listCalendars();
  if (!listed.ok) {
    if (listed.code === "scope") {
      return { ok: false, code: "calendar_not_listed", message: "Эта область доступа не показывает список календарей. Подтвердите создание нового календаря и одной пары." };
    }
    const code = listed.code === "auth" || listed.code === "forbidden" ? listed.code : "error";
    return googleFailure(code);
  }
  if (!listed.calendars.some((item) => item.id === calendarId)) {
    return { ok: false, code: "calendar_not_listed", message: "Календарь не найден среди календарей приложения. Чужой календарь с тем же названием не используется." };
  }
  const state = await deps.store.load();
  const next = { ...state, googleCalendarId: calendarId };
  await deps.store.save(next);
  return { ok: true, code: "calendar_chosen", message: "Календарь выбран. Пара ещё не записана." };
}

async function confirmTestEvent(message: unknown, deps: MessageDeps): Promise<unknown> {
  const unavailable = googleUnavailable(deps);
  if (unavailable) return unavailable;
  const api = deps.calendarApi;
  if (!api) return unavailable;
  if (confirmInFlight) return { ok: false, code: "write_in_progress", message: "Запись уже выполняется." };
  const snapshotHash = message && typeof message === "object" ? (message as { snapshotHash?: unknown }).snapshotHash : undefined;
  const createCalendar = Boolean(message && typeof message === "object" && (message as { createCalendar?: unknown }).createCalendar === true);
  if (typeof snapshotHash !== "string") return { ok: false, code: "snapshot_changed", message: "Нет снимка для подтверждения." };
  confirmInFlight = true;
  try {
    const state = await deps.store.load();
    const result = await runConfirmedTestWrite({
      state,
      snapshotHash,
      createCalendar,
      now: deps.now(),
      newEventId: deps.newEventId?.() ?? googleEventId(crypto.randomUUID()),
      api,
      save: (next) => deps.store.save(next),
    });
    if (result.state !== state) await deps.store.save(result.state);
    logTechnical({ code: result.code, count: result.ok ? 1 : 0 });
    if (result.ok && result.code === "test_event_written" && result.state.settings.openCalendarAfterWrite) {
      const url = googleCalendarUrl(result.state.googleCalendarId);
      if (url && deps.openCalendar) {
        try {
          await deps.openCalendar(url);
        } catch {
          logTechnical({ code: "calendar_open_failed" });
        }
      }
    }
    return { ok: result.ok, code: result.code, message: result.message, lastSuccessfulWriteAt: result.state.lastSuccessfulWriteAt };
  } finally {
    confirmInFlight = false;
  }
}

function googleUnavailable(deps: MessageDeps): unknown {
  if (!deps.oauthConfigured || !deps.calendarApi) {
    return { ok: false, code: "oauth_not_configured", message: "OAuth client ID ещё не вставлен в сборку. Пароль Google в расширение не вводится." };
  }
  return null;
}

function googleFailure(code: "auth" | "forbidden" | "error"): unknown {
  if (code === "auth") return { ok: false, code: "auth_required", message: "Нужно подключить Google. Запись не выполнялась." };
  if (code === "forbidden") return { ok: false, code: "google_forbidden", message: "Google отказал в доступе. Это не обрабатывается как истёкший вход." };
  return { ok: false, code: "google_error", message: "Google не ответил. Запись не выполнялась." };
}

async function findAppCalendars(deps: MessageDeps): Promise<unknown> {
  const unavailable = googleUnavailable(deps);
  if (unavailable) return unavailable;
  const api = deps.calendarApi;
  if (!api) return unavailable;
  const listed = await api.listCalendars();
  if (!listed.ok) {
    if (listed.code === "scope") {
      return { ok: false, code: "calendar_not_listed", message: "Эта область доступа не показывает список календарей. Ничего не удалено." };
    }
    if (listed.code === "auth") return { ok: false, code: "auth_required", message: "Нужно подключить Google. Календарь не удалён." };
    if (listed.code === "forbidden") return { ok: false, code: "google_forbidden", message: "Google отказал в доступе к списку календарей. Ничего не удалено." };
    return { ok: false, code: "google_error", message: "Не удалось проверить календари. Ничего не удалено." };
  }
  const counts = new Map<string, number>();
  let skipped = 0;
  for (const calendar of listed.calendars) {
    if (calendar.primary === true || calendar.id.includes("://")) continue;
    const probe = await api.hasAppEvents(calendar.id);
    if (!probe.ok) {
      if (probe.code === "auth") return { ok: false, code: "auth_required", message: "Нужно подключить Google. Календарь не удалён." };
      skipped += 1;
      continue;
    }
    counts.set(calendar.id, probe.found ? 1 : 0);
  }
  const calendars = selectRecoverableCalendars(listed.calendars, counts);
  const skippedNote = skipped > 0 ? " Часть календарей проверить не удалось, они в список не вошли." : "";
  const message = calendars.length === 0
    ? `Календарь расширения не найден. Чужой календарь с таким названием не удалён.${skippedNote}`
    : `Выберите календарь. Удаление начнётся только после отдельного подтверждения.${skippedNote}`;
  return { ok: true, code: "calendars_found", calendars, message };
}

function foundCalendars(value: unknown): RecoverableCalendar[] | null {
  if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true) return null;
  if (!("calendars" in value) || !Array.isArray(value.calendars)) return null;
  const calendars: RecoverableCalendar[] = [];
  for (const item of value.calendars) {
    if (!item || typeof item !== "object") return null;
    const source = item as { id?: unknown; summary?: unknown; hasAppEvents?: unknown };
    if (typeof source.id !== "string" || typeof source.summary !== "string" || typeof source.hasAppEvents !== "boolean") return null;
    calendars.push({ id: source.id, summary: source.summary, hasAppEvents: source.hasAppEvents });
  }
  return calendars;
}

async function deleteAppCalendar(deps: MessageDeps, request: unknown): Promise<unknown> {
  const unavailable = googleUnavailable(deps);
  if (unavailable) return unavailable;
  const api = deps.calendarApi;
  if (!api) return unavailable;
  const state = await deps.store.load();
  let id = state.googleCalendarId;
  if (!id) {
    const requested = request && typeof request === "object" ? (request as { calendarId?: unknown }).calendarId : undefined;
    if (typeof requested !== "string" || !requested || requested.includes("://")) {
      return { ok: false, code: "no_calendar", message: "Календарь расширения ещё не создан. Удалять нечего." };
    }
    const found = await findAppCalendars(deps);
    const calendars = foundCalendars(found);
    if (!calendars) return found;
    if (!calendars.some((item) => item.id === requested)) {
      return { ok: false, code: "calendar_not_listed", message: "Этот календарь не выбран: его нет среди календарей расширения." };
    }
    id = requested;
  }
  const removed = await api.deleteCalendar(id);
  if (!removed.ok && removed.code !== "missing") {
    if (removed.code === "auth") return { ok: false, code: "auth_required", message: "Нужно подключить Google. Календарь не удалён." };
    if (removed.code === "forbidden") return { ok: false, code: "google_forbidden", message: "Google отказал в удалении календаря. Календарь на месте." };
    const status = removed.status > 0 ? ` Ответ Google: ${removed.status}.` : "";
    return { ok: false, code: "google_error", message: `Календарь не удалён.${status}` };
  }
  await deps.store.save({
    ...state,
    googleCalendarId: null,
    testEvent: null,
    lessonMappings: [],
    syncJournal: [],
    lessonColorsReleased: false,
  });
  logTechnical({ code: "calendar_deleted" });
  const label = state.googleCalendarId ? "«Расписание вуза»" : "выбранный календарь";
  const message = removed.ok
    ? `Календарь ${label} удалён вместе с парами. Настройки расширения сохранены.`
    : "Календарь в Google уже не найден. Ссылка на него снята. Настройки расширения сохранены.";
  return { ok: true, code: "calendar_deleted", message };
}

async function applyCalendarColor(state: AppState, deps: MessageDeps): Promise<string> {
  const colorId = state.settings.calendarColorId;
  if (!colorId) return "Настройки сохранены.";
  if (!state.googleCalendarId) return "Настройки сохранены. Выбранный цвет будет у нового календаря.";
  if (!deps.oauthConfigured || !deps.calendarApi) return "Настройки сохранены. Чтобы задать цвет календарю, подключите Google.";
  const painted = await deps.calendarApi.setCalendarColor(state.googleCalendarId, colorId);
  if (!painted.ok) {
    if (painted.code === "auth") return "Настройки сохранены. Цвет не отправлен: Chrome не отдал вход. Нажмите «Подключить Google», затем снова «Сохранить».";
    if (painted.code === "scope") return "Настройки сохранены. Нужно ещё раз подключить Google и разрешить цвет календаря.";
    const status = painted.status > 0 ? ` Ответ Google: ${painted.status}.` : "";
    return `Настройки сохранены. Google не принял цвет календаря.${status}`;
  }
  let next = state;
  if (!next.calendarListReady) {
    next = { ...next, calendarListReady: true };
    await deps.store.save(next);
  }
  if (!next.lessonColorsReleased) {
    const released = await deps.calendarApi.releaseLessonColors(state.googleCalendarId);
    if (!released.ok) return "Настройки сохранены. Цвет календаря обновлён. Прежний цвет пар снять не удалось, сохраните ещё раз.";
    next = { ...next, lessonColorsReleased: true };
    await deps.store.save(next);
  }
  return "Настройки сохранены. Цвет календаря обновлён.";
}

async function planSync(deps: MessageDeps): Promise<unknown> {
  const unavailable = googleUnavailable(deps);
  if (unavailable) return unavailable;
  const api = deps.calendarApi;
  if (!api) return unavailable;
  const state = await deps.store.load();
  const snapshot = state.lastSnapshot;
  if (!snapshot || (snapshot.lessons.length === 0 && snapshot.coverageStatus !== "complete")) {
    return { ok: false, code: "no_lesson", message: "Снимок неполный или пустой. Отмены не формируются и в календарь ничего не отправлено.", canConfirm: false, canCancel: false, createCalendar: false };
  }
  const remembered = await rememberExistingCalendar({ state, api, save: (next) => deps.store.save(next) });
  if (!remembered.ok) {
    return { ok: false, code: remembered.code, message: remembered.message, canConfirm: false, canCancel: false, createCalendar: false };
  }
  const ready = remembered.state;
  if (!ready.googleCalendarId) {
    const items = await buildSyncPlan(snapshot, [], ready.lessonMappings);
    const counts = countSync(items);
    return {
      ok: true,
      code: "sync_plan",
      message: describeSyncPlan(counts, true),
      snapshotHash: snapshot.snapshotHash,
      canConfirm: counts.create + counts.update > 0,
      canCancel: counts.cancel > 0,
      createCalendar: true,
    };
  }
  const listed = await api.listOwnedEvents(ready.googleCalendarId);
  if (!listed.ok) return googleFailure(listed.code === "auth" ? "auth" : listed.code === "forbidden" ? "forbidden" : "error");
  const items = await buildSyncPlan(snapshot, listed.events, ready.lessonMappings);
  const counts = countSync(items);
  const others = await calendarsWithAppEvents(api);
  const extra = others.ok ? others.calendars.filter((item) => item.id !== ready.googleCalendarId).length : 0;
  const duplicateNote = extra > 0
    ? " Есть ещё календарь с парами этого расширения. Сравнение идёт по уже выбранному. Кнопка «Удалить календарь» удаляет только его."
    : "";
  return {
    ok: true,
    code: "sync_plan",
    message: `${describeSyncPlan(counts, false)}${duplicateNote}`,
    snapshotHash: snapshot.snapshotHash,
    canConfirm: counts.create + counts.update > 0,
    canCancel: counts.cancel > 0,
    createCalendar: false,
  };
}

async function confirmSync(message: unknown, deps: MessageDeps): Promise<unknown> {
  const unavailable = googleUnavailable(deps);
  if (unavailable) return unavailable;
  const api = deps.calendarApi;
  if (!api) return unavailable;
  if (confirmInFlight) return { ok: false, code: "write_in_progress", message: "Запись уже выполняется." };
  const snapshotHash = message && typeof message === "object" ? (message as { snapshotHash?: unknown }).snapshotHash : undefined;
  if (typeof snapshotHash !== "string") return { ok: false, code: "snapshot_changed", message: "Нет снимка для подтверждения." };
  confirmInFlight = true;
  try {
    const state = await deps.store.load();
    const result = await runConfirmedSync({
      state,
      snapshotHash,
      now: deps.now(),
      api,
      save: (next) => deps.store.save(next),
      newOperationId: () => googleEventId(crypto.randomUUID()) ?? "00000",
    });
    if (result.state !== state) await deps.store.save(result.state);
    logTechnical({ code: result.code, count: result.ok ? 1 : 0 });
    if (result.ok && result.code !== "sync_unchanged" && result.state.settings.openCalendarAfterWrite) {
      const url = googleCalendarUrl(result.state.googleCalendarId);
      if (url && deps.openCalendar) {
        try {
          await deps.openCalendar(url);
        } catch {
          logTechnical({ code: "calendar_open_failed" });
        }
      }
    }
    return { ok: result.ok, code: result.code, message: result.message, lastSuccessfulWriteAt: result.state.lastSuccessfulWriteAt };
  } finally {
    confirmInFlight = false;
  }
}

async function confirmCancellations(message: unknown, deps: MessageDeps): Promise<unknown> {
  const unavailable = googleUnavailable(deps);
  if (unavailable) return unavailable;
  const api = deps.calendarApi;
  if (!api) return unavailable;
  if (confirmInFlight) return { ok: false, code: "write_in_progress", message: "Запись уже выполняется." };
  const snapshotHash = message && typeof message === "object" ? (message as { snapshotHash?: unknown }).snapshotHash : undefined;
  if (typeof snapshotHash !== "string") return { ok: false, code: "snapshot_changed", message: "Нет снимка для подтверждения." };
  confirmInFlight = true;
  try {
    const state = await deps.store.load();
    const result = await runConfirmedCancellations({
      state,
      snapshotHash,
      now: deps.now(),
      api,
      save: (next) => deps.store.save(next),
      newOperationId: () => googleEventId(crypto.randomUUID()) ?? "00000",
    });
    if (result.state !== state) await deps.store.save(result.state);
    logTechnical({ code: result.code, count: result.ok ? 1 : 0 });
    return { ok: result.ok, code: result.code, message: result.message };
  } finally {
    confirmInFlight = false;
  }
}

export function isTrustedExtensionSender(sender: MessageSender, extensionId: string): boolean {
  if (!sender.id || sender.id !== extensionId || !sender.url) return false;
  return sender.url.startsWith(`chrome-extension://${extensionId}/`);
}
