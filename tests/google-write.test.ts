import { describe, expect, it } from "vitest";
import { handleMessage } from "../src/background/handle-message";
import { googleEventId } from "../src/calendar/event-id";
import { createGoogleCalendarApi } from "../src/calendar/google-api";
import { authorizedRequest, CALENDAR_SCOPES } from "../src/calendar/google-http";
import { selectRecoverableCalendars } from "../src/calendar/recover";
import { eventBody, planTestLesson, type CalendarApi } from "../src/calendar/test-write";
import { GOOGLE_WRITES_ENABLED, googleCalendarWrite } from "../src/calendar/writes";
import { createMemoryStore } from "../src/storage/state";
import { CAPTURED_AT, snapshot } from "./helpers";

const extensionId = "extensionidexample";
const sender = { id: extensionId, url: `chrome-extension://${extensionId}/src/ui/review/index.html` };
const eventId = "0123456789abcdef0123456789abcdef";

describe("confirmed Google test write", () => {
  it("reserves one event id and does not send the lesson type", async () => {
    expect(googleEventId("01234567-89ab-cdef-0123-456789abcdef")).toBe(eventId);
    expect(googleEventId("not-a-uuid")).toBeNull();
    const week = await snapshot("normal-week");
    const plan = await planTestLesson(week);
    expect(plan).not.toBeNull();
    if (!plan) return;
    const body = eventBody(plan, eventId);
    expect(JSON.stringify(body)).not.toContain("оффлайн");
    expect(JSON.stringify(body)).not.toContain("attendees");
    expect(JSON.stringify(body)).not.toContain("sendUpdates");
    expect(body.extendedProperties.private.app).toBe("university-calendar-sync");
    expect(GOOGLE_WRITES_ENABLED).toBe(false);
    expect(() => googleCalendarWrite()).toThrow(/отключена/);
  });

  it("creates a calendar only after confirmation and keeps the access token out of storage", async () => {
    const week = await snapshot("normal-week");
    const store = createMemoryStore();
    await store.save({ ...store.snapshot(), lastSnapshot: week });
    const calls: string[] = [];
    const token = "ya29.synthetic-token";
    const api: CalendarApi = {
      async hasSession() {
        return true;
      },
      async listCalendars() {
        return { ok: true, calendars: [] };
      },
      async getCalendar() {
        return "missing";
      },
      async createCalendar() {
        calls.push("create");
        return { ok: true, id: "app-calendar-1" };
      },
      async getEvent() {
        return { ok: false, code: "missing" };
      },
      async insertEvent(_calendarId, body) {
        calls.push("insert");
        expect(store.snapshot().googleCalendarId).toBe("app-calendar-1");
        expect(body.id).toBe(eventId);
        expect(JSON.stringify(store.snapshot())).not.toContain(token);
        return { ok: true };
      },
      async setCalendarColor() {
        throw new Error("color must not be set");
      },
      async releaseLessonColors() {
        return { ok: true };
      },
      async deleteCalendar() {
        throw new Error("calendar must not be deleted");
      },
      async deleteEvent() {
        throw new Error("event must not be deleted");
      },
      async patchEvent() {
        throw new Error("event must not be patched");
      },
      async listOwnedEvents() {
        throw new Error("events must not be listed");
      },
      async hasAppEvents() {
        throw new Error("app events must not be checked");
      },
    };
    const deps = {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
      oauthConfigured: true,
      calendarApi: api,
      newEventId: () => eventId,
    };
    const refused = await handleMessage({ type: "confirmTestEvent", snapshotHash: "ab".repeat(32), createCalendar: true }, sender, deps);
    expect(refused).toMatchObject({ ok: false, code: "snapshot_changed" });
    expect(calls).toEqual([]);

    const preview = await handleMessage({ type: "dryRunGoogle" }, sender, deps);
    expect(preview).toMatchObject({ ok: true, canConfirm: true, createCalendar: true });
    expect(calls).toEqual([]);

    const opened: string[] = [];
    const written = await handleMessage({ type: "confirmTestEvent", snapshotHash: week.snapshotHash, createCalendar: true }, sender, deps);
    expect(written).toMatchObject({ ok: true, code: "test_event_written" });
    expect(calls).toEqual(["create", "insert"]);
    expect(store.snapshot().lastSuccessfulWriteAt).toBe(CAPTURED_AT);
    expect(JSON.stringify(store.snapshot())).not.toContain(token);
    expect(store.snapshot().testEvent?.done).toBe(true);

    await store.save({
      ...store.snapshot(),
      settings: { ...store.snapshot().settings, openCalendarAfterWrite: true },
    });
    const again = await handleMessage(
      { type: "confirmTestEvent", snapshotHash: week.snapshotHash, createCalendar: true },
      sender,
      { ...deps, openCalendar: async (url) => { opened.push(url); } },
    );
    expect(again).toMatchObject({ ok: true, code: "already_written" });
    expect(calls).toEqual(["create", "insert"]);
    expect(opened).toEqual([]);

    await store.save({ ...store.snapshot(), testEvent: null, lastSuccessfulWriteAt: null });
    const openedWrite = await handleMessage(
      { type: "confirmTestEvent", snapshotHash: week.snapshotHash, createCalendar: true },
      sender,
      { ...deps, openCalendar: async (url) => { opened.push(url); } },
    );
    expect(openedWrite).toMatchObject({ ok: true, code: "test_event_written" });
    expect(opened).toEqual(["https://calendar.google.com/calendar/u/0/r?cid=app-calendar-1"]);
  });

  it("does not adopt an unlisted calendar and asks before creating a second one", async () => {
    const week = await snapshot("normal-week");
    const store = createMemoryStore();
    await store.save({ ...store.snapshot(), lastSnapshot: week });
    const api: CalendarApi = {
      async hasSession() {
        return true;
      },
      async listCalendars() {
        return { ok: true, calendars: [{ id: "app-calendar-1", summary: "Расписание вуза" }] };
      },
      async getCalendar() {
        return "ok";
      },
      async createCalendar() {
        throw new Error("calendar must not be created");
      },
      async getEvent() {
        return { ok: false, code: "missing" };
      },
      async insertEvent() {
        throw new Error("event must not be inserted");
      },
      async setCalendarColor() {
        throw new Error("color must not be set");
      },
      async releaseLessonColors() {
        return { ok: true };
      },
      async deleteCalendar() {
        throw new Error("calendar must not be deleted");
      },
      async deleteEvent() {
        throw new Error("event must not be deleted");
      },
      async patchEvent() {
        throw new Error("event must not be patched");
      },
      async listOwnedEvents() {
        throw new Error("events must not be listed");
      },
      async hasAppEvents() {
        throw new Error("app events must not be checked");
      },
    };
    const deps = {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
      oauthConfigured: true,
      calendarApi: api,
      newEventId: () => eventId,
    };
    const preview = await handleMessage({ type: "dryRunGoogle" }, sender, deps);
    expect(preview).toMatchObject({ ok: true, code: "dry_run", canConfirm: true, createCalendar: true });
    const rejected = await handleMessage({ type: "chooseGoogleCalendar", calendarId: "other-calendar" }, sender, deps);
    expect(rejected).toMatchObject({ ok: false, code: "calendar_not_listed" });
    expect(store.snapshot().googleCalendarId).toBeNull();
    const chosen = await handleMessage({ type: "chooseGoogleCalendar", calendarId: "app-calendar-1" }, sender, deps);
    expect(chosen).toMatchObject({ ok: true, code: "calendar_chosen" });
    expect(store.snapshot().googleCalendarId).toBe("app-calendar-1");
    expect(store.snapshot().lastSuccessfulWriteAt).toBeNull();
  });

  it("refreshes an expired token once without asking again", async () => {
    const seen: string[] = [];
    const result = await authorizedRequest({
      tokens: {
        async token(interactive) {
          expect(interactive).toBe(false);
          return seen.length === 0 ? "expired-token" : "fresh-token";
        },
        async forget(token) {
          expect(token).toBe("expired-token");
        },
      },
      send: async (token) => {
        seen.push(token);
        return token === "expired-token" ? { status: 401, body: {} } : { status: 200, body: { id: "app-calendar-1" } };
      },
      request: { method: "GET", path: "/calendar/v3/calendars/app-calendar-1" },
      sleep: async () => undefined,
      random: () => 0,
    });
    expect(result.status).toBe(200);
    expect(seen).toEqual(["expired-token", "fresh-token"]);
  });

  it("treats a narrow calendar scope as connected and still allows one new calendar", async () => {
    const week = await snapshot("normal-week");
    const store = createMemoryStore();
    await store.save({ ...store.snapshot(), lastSnapshot: week });
    const api: CalendarApi = {
      async hasSession() {
        return true;
      },
      async listCalendars() {
        return { ok: false, code: "scope" };
      },
      async getCalendar() {
        return "missing";
      },
      async createCalendar() {
        return { ok: true, id: "app-calendar-1" };
      },
      async getEvent() {
        return { ok: false, code: "missing" };
      },
      async insertEvent() {
        return { ok: true };
      },
      async setCalendarColor() {
        return { ok: true };
      },
      async releaseLessonColors() {
        return { ok: true };
      },
      async deleteCalendar() {
        throw new Error("calendar must not be deleted");
      },
      async deleteEvent() {
        throw new Error("event must not be deleted");
      },
      async patchEvent() {
        throw new Error("event must not be patched");
      },
      async listOwnedEvents() {
        return { ok: true, events: [] };
      },
      async hasAppEvents() {
        return { ok: true, found: false };
      },
    };
    const deps = {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
      oauthConfigured: true,
      calendarApi: api,
      newEventId: () => eventId,
    };
    const connected = await handleMessage({ type: "connectGoogle" }, sender, deps);
    expect(connected).toMatchObject({ ok: true, code: "google_connected" });
    expect(store.snapshot().googleConnected).toBe(true);
    const preview = await handleMessage({ type: "dryRunGoogle" }, sender, deps);
    expect(preview).toMatchObject({ ok: true, code: "dry_run", canConfirm: true, createCalendar: true });
  });

  it("sends one calendar color and does not color each lesson", async () => {
    expect(CALENDAR_SCOPES).toEqual([
      "https://www.googleapis.com/auth/calendar.app.created",
      "https://www.googleapis.com/auth/calendar.calendarlist",
    ]);
    const seen: { url: string; body: unknown }[] = [];
    const api = createGoogleCalendarApi({
      tokens: {
        async token() {
          return "ya29.synthetic-token";
        },
        async forget() {
          throw new Error("token must stay cached");
        },
      },
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        return new Response(JSON.stringify({ id: "app@group.calendar.google.com", colorId: "16" }), { status: 200 });
      },
    });
    await expect(api.setCalendarColor("app@group.calendar.google.com", "16")).resolves.toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain("/calendar/v3/users/me/calendarList/app%40group.calendar.google.com");
    expect(seen[0]?.url).not.toContain("/events");
    expect(seen[0]?.body).toEqual({ colorId: "16" });
    expect(JSON.stringify(seen)).not.toContain("ya29.synthetic-token");
  });

  it("clears a lesson color once and leaves an uncolored lesson untouched", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const api = createGoogleCalendarApi({
      tokens: {
        async token() {
          return "ya29.synthetic-token";
        },
        async forget() {
          throw new Error("token must stay cached");
        },
      },
      fetchImpl: async (url, init) => {
        const address = String(url);
        seen.push({ url: address, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (address.includes("/events?")) {
          return new Response(JSON.stringify({
            items: [
              { id: "evt1", status: "confirmed", colorId: "9", extendedProperties: { private: { app: "university-calendar-sync", lessonKey: "k", sourceKey: "s" } } },
              { id: "evt2", status: "confirmed", extendedProperties: { private: { app: "university-calendar-sync", lessonKey: "k2", sourceKey: "s" } } },
            ],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ id: "evt1" }), { status: 200 });
      },
    });
    await expect(api.releaseLessonColors("app@group.calendar.google.com")).resolves.toEqual({ ok: true });
    expect(seen.map((item) => item.url).join(" ")).not.toContain("/events/evt2");
    expect(seen[1]?.body).toEqual({ colorId: null });
    expect(JSON.stringify(seen)).not.toContain("ya29.synthetic-token");
  });

  it("deletes only the saved calendar and keeps the extension settings", async () => {
    const seen: { url: string; method: string }[] = [];
    const api = createGoogleCalendarApi({
      tokens: {
        async token() {
          return "ya29.synthetic-token";
        },
        async forget() {
          throw new Error("token must stay cached");
        },
      },
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), method: String(init?.method) });
        return new Response(null, { status: 204 });
      },
    });
    await expect(api.deleteCalendar("app@group.calendar.google.com")).resolves.toEqual({ ok: true });
    expect(seen).toEqual([{
      url: "https://www.googleapis.com/calendar/v3/calendars/app%40group.calendar.google.com",
      method: "DELETE",
    }]);

    const store = createMemoryStore();
    const lessonKey = `provisional:${"a".repeat(64)}`;
    await store.save({
      ...store.snapshot(),
      googleCalendarId: "app@group.calendar.google.com",
      googleConnected: true,
      lessonMappings: [{ lessonKey, eventId: "abcde", sourceHash: "b".repeat(64), managedHash: "c".repeat(64) }],
      testEvent: { snapshotHash: "d".repeat(64), lessonKey, eventId: "abcde", calendarId: "app@group.calendar.google.com", done: true },
      settings: { ...store.snapshot().settings, groupName: "Группа А-1", calendarColorId: "16" },
    });
    const deletedIds: string[] = [];
    const handlerApi: CalendarApi = {
      async hasSession() {
        return true;
      },
      async listCalendars() {
        return { ok: true, calendars: [] };
      },
      async getCalendar() {
        return "ok";
      },
      async createCalendar() {
        throw new Error("calendar must not be created");
      },
      async setCalendarColor() {
        throw new Error("color must not be set");
      },
      async releaseLessonColors() {
        throw new Error("colors must not be cleared");
      },
      async deleteCalendar(id) {
        deletedIds.push(id);
        return { ok: true };
      },
      async deleteEvent() {
        throw new Error("event must not be deleted");
      },
      async getEvent() {
        return { ok: false, code: "missing" };
      },
      async insertEvent() {
        throw new Error("event must not be inserted");
      },
      async patchEvent() {
        throw new Error("event must not be patched");
      },
      async listOwnedEvents() {
        return { ok: true, events: [] };
      },
      async hasAppEvents() {
        return { ok: true, found: false };
      },
    };
    const deps = {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
      oauthConfigured: true,
      calendarApi: handlerApi,
    };
    const removed = await handleMessage({ type: "deleteCalendar", calendarId: "other@group.calendar.google.com" }, sender, deps);
    expect(removed).toMatchObject({ ok: true, code: "calendar_deleted" });
    expect(deletedIds).toEqual(["app@group.calendar.google.com"]);
    expect(store.snapshot().googleCalendarId).toBeNull();
    expect(store.snapshot().lessonMappings).toEqual([]);
    expect(store.snapshot().testEvent).toBeNull();
    expect(store.snapshot().googleConnected).toBe(true);
    expect(store.snapshot().settings.groupName).toBe("Группа А-1");
    expect(store.snapshot().settings.calendarColorId).toBe("16");
    const absent = await handleMessage({ type: "deleteCalendar" }, sender, deps);
    expect(absent).toMatchObject({ ok: false, code: "no_calendar" });
    expect(deletedIds).toEqual(["app@group.calendar.google.com"]);
  });
});

describe("calendar recovery after local data is cleared", () => {
  it("lists only recoverable calendars and deletes the one the user picks", async () => {
    expect(selectRecoverableCalendars(
      [{ id: "https://evil.example/calendar", summary: "Расписание вуза" }],
      new Map([["https://evil.example/calendar", 1]]),
    )).toEqual([]);
    const deletedIds: string[] = [];
    const probes: string[] = [];
    const api: CalendarApi = {
      async hasSession() {
        return true;
      },
      async listCalendars() {
        return {
          ok: true,
          calendars: [
            { id: "me@gmail.com", summary: "Основной", primary: true },
            { id: "empty@group.calendar.google.com", summary: "Расписание вуза" },
            { id: "renamed@group.calendar.google.com", summary: "Учёба" },
            { id: "foreign@group.calendar.google.com", summary: "Личное" },
            { id: "hidden@group.calendar.google.com", summary: "Расписание вуза" },
          ],
        };
      },
      async getCalendar() {
        return "ok";
      },
      async createCalendar() {
        throw new Error("calendar must not be created");
      },
      async setCalendarColor() {
        throw new Error("color must not be set");
      },
      async releaseLessonColors() {
        throw new Error("colors must not be cleared");
      },
      async deleteCalendar(id) {
        deletedIds.push(id);
        return { ok: true };
      },
      async deleteEvent() {
        throw new Error("event must not be deleted");
      },
      async getEvent() {
        return { ok: false, code: "missing" };
      },
      async insertEvent() {
        throw new Error("event must not be inserted");
      },
      async patchEvent() {
        throw new Error("event must not be patched");
      },
      async listOwnedEvents() {
        throw new Error("events must not be listed");
      },
      async hasAppEvents(id) {
        probes.push(id);
        if (id === "hidden@group.calendar.google.com") return { ok: false, code: "forbidden" };
        return { ok: true, found: id === "renamed@group.calendar.google.com" };
      },
    };
    const store = createMemoryStore();
    await store.save({
      ...store.snapshot(),
      googleConnected: true,
      settings: { ...store.snapshot().settings, groupName: "Группа А-1" },
    });
    const deps = {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
      oauthConfigured: true,
      calendarApi: api,
    };
    const found = await handleMessage({ type: "findAppCalendars" }, sender, deps);
    expect(found).toMatchObject({
      ok: true,
      code: "calendars_found",
      calendars: [
        { id: "empty@group.calendar.google.com", summary: "Расписание вуза", hasAppEvents: false },
        { id: "renamed@group.calendar.google.com", summary: "Учёба", hasAppEvents: true },
      ],
    });
    expect(JSON.stringify(found)).toContain("Часть календарей проверить не удалось");
    expect(probes).not.toContain("me@gmail.com");
    expect(deletedIds).toEqual([]);
    expect(store.snapshot().googleCalendarId).toBeNull();
    const refused = await handleMessage({ type: "deleteCalendar", calendarId: "me@gmail.com" }, sender, deps);
    expect(refused).toMatchObject({ ok: false, code: "calendar_not_listed" });
    expect(deletedIds).toEqual([]);
    const removed = await handleMessage({ type: "deleteCalendar", calendarId: "renamed@group.calendar.google.com" }, sender, deps);
    expect(removed).toMatchObject({ ok: true, code: "calendar_deleted" });
    expect(String((removed as { message?: string }).message)).toContain("выбранный календарь");
    expect(deletedIds).toEqual(["renamed@group.calendar.google.com"]);
    expect(store.snapshot().googleCalendarId).toBeNull();
    expect(store.snapshot().settings.groupName).toBe("Группа А-1");
  });

  it("reads the primary flag and probes app events with one request", async () => {
    const seen: string[] = [];
    const api = createGoogleCalendarApi({
      tokens: {
        async token() {
          return "ya29.synthetic-token";
        },
        async forget() {
          throw new Error("token must stay cached");
        },
      },
      fetchImpl: async (url) => {
        const address = String(url);
        seen.push(address);
        if (address.includes("calendarList")) {
          return new Response(JSON.stringify({
            items: [
              { id: "me@gmail.com", summary: "Основной", primary: true },
              { id: "app@group.calendar.google.com", summary: "Расписание вуза" },
            ],
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [{ id: "evt1" }] }), { status: 200 });
      },
    });
    await expect(api.listCalendars()).resolves.toEqual({
      ok: true,
      calendars: [
        { id: "me@gmail.com", summary: "Основной", primary: true },
        { id: "app@group.calendar.google.com", summary: "Расписание вуза" },
      ],
    });
    await expect(api.hasAppEvents("app@group.calendar.google.com")).resolves.toEqual({ ok: true, found: true });
    expect(seen[1]).toContain("maxResults=1");
    expect(seen[1]).toContain("privateExtendedProperty=");
    expect(seen.join(" ")).not.toContain("ya29.synthetic-token");
  });
});
