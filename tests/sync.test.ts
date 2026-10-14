import { describe, expect, it } from "vitest";
import { handleMessage } from "../src/background/handle-message";
import { planLesson, type CalendarApi, type OwnedEvent } from "../src/calendar/test-write";
import { createMemoryStore } from "../src/storage/state";
import { CAPTURED_AT, snapshot } from "./helpers";

const extensionId = "extensionidexample";
const sender = { id: extensionId, url: `chrome-extension://${extensionId}/src/ui/review/index.html` };

describe("schedule sync", () => {
  it("creates each lesson once and does not write again when the calendar already matches", async () => {
    const week = await snapshot("normal-week");
    const store = createMemoryStore();
    await store.save({ ...store.snapshot(), lastSnapshot: week });
    const stored: OwnedEvent[] = [];
    let created = false;
    const api: CalendarApi = {
      async hasSession() {
        return true;
      },
      async listCalendars() {
        return { ok: true, calendars: [] };
      },
      async getCalendar() {
        return created ? "ok" : "missing";
      },
      async createCalendar() {
        created = true;
        return { ok: true, id: "app-calendar-1" };
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
      async getEvent() {
        return { ok: false, code: "missing" };
      },
      async insertEvent(_calendarId, body) {
        stored.push({
          id: body.id,
          etag: "etag-1",
          summary: body.summary,
          location: body.location ?? "",
          description: body.description ?? "",
          start: body.start.dateTime,
          end: body.end.dateTime,
          timeZone: body.start.timeZone,
          lessonKey: body.extendedProperties.private.lessonKey ?? "",
          sourceKey: body.extendedProperties.private.sourceKey ?? "",
          sourceHash: body.extendedProperties.private.sourceHash ?? "",
        });
        return { ok: true };
      },
      async patchEvent() {
        throw new Error("event must not be patched");
      },
      async listOwnedEvents() {
        return { ok: true, events: stored };
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
    };
    const preview = await handleMessage({ type: "planSync" }, sender, deps);
    expect(preview).toMatchObject({ ok: true, canConfirm: true, createCalendar: true });
    expect(String((preview as { message?: string }).message)).toContain(`создать ${week.lessons.length}`);
    const written = await handleMessage({ type: "confirmSync", snapshotHash: week.snapshotHash }, sender, deps);
    expect(written).toMatchObject({ ok: true, code: "sync_written" });
    expect(stored).toHaveLength(week.lessons.length);
    expect(new Set(stored.map((item) => item.id)).size).toBe(week.lessons.length);
    const again = await handleMessage({ type: "confirmSync", snapshotHash: week.snapshotHash }, sender, deps);
    expect(again).toMatchObject({ ok: true, code: "sync_unchanged" });
    expect(stored).toHaveLength(week.lessons.length);
  });

  it("does not overwrite a manually edited event and patches a changed lesson", async () => {
    const week = await snapshot("normal-week");
    const first = week.lessons[0];
    const second = week.lessons[1];
    if (!first || !second) throw new Error("fixture is missing lessons");
    const edited = await planLesson(week, first);
    const changed = await planLesson(week, second);
    const events: OwnedEvent[] = [
      {
        id: "editedevent00000000000000000000",
        etag: "etag-edited",
        summary: "Изменено вручную",
        location: edited.location,
        description: edited.description,
        start: edited.start,
        end: edited.end,
        timeZone: edited.timeZone,
        lessonKey: edited.lessonKey,
        sourceKey: edited.sourceKey,
        sourceHash: edited.sourceHash,
      },
      {
        id: "changedevent0000000000000000000",
        etag: "etag-changed",
        summary: "Старое название",
        location: changed.location,
        description: changed.description,
        start: changed.start,
        end: changed.end,
        timeZone: changed.timeZone,
        lessonKey: changed.lessonKey,
        sourceKey: changed.sourceKey,
        sourceHash: "ab".repeat(32),
      },
    ];
    const patched: string[] = [];
    const store = createMemoryStore();
    await store.save({ ...store.snapshot(), lastSnapshot: week, googleCalendarId: "app-calendar-1" });
    const api: CalendarApi = {
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
        return { ok: true };
      },
      async deleteCalendar() {
        throw new Error("calendar must not be deleted");
      },
      async deleteEvent() {
        throw new Error("event must not be deleted");
      },
      async getEvent() {
        return { ok: false, code: "missing" };
      },
      async insertEvent() {
        return { ok: true };
      },
      async patchEvent(_calendarId, eventId) {
        patched.push(eventId);
        return { ok: true };
      },
      async listOwnedEvents() {
        return { ok: true, events };
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
    };
    const written = await handleMessage({ type: "confirmSync", snapshotHash: week.snapshotHash }, sender, deps);
    expect(written).toMatchObject({ ok: true, code: "sync_partial" });
    expect(String((written as { message?: string }).message)).toContain("Спорных");
    expect(patched).toEqual(["changedevent0000000000000000000"]);
  });

  it("sends the chosen calendar color only when that calendar already exists", async () => {
    const store = createMemoryStore();
    const colors: string[] = [];
    const api: CalendarApi = {
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
      async setCalendarColor(_id, colorId) {
        colors.push(colorId);
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
      calendarApi: api,
    };
    const settings = { timeZone: "Europe/Moscow", profileLabel: "", groupName: "", sourceOrigin: "", sourcePathPrefix: "", calendarColorId: "16" };
    const saved = await handleMessage({ type: "saveSettings", settings }, sender, deps);
    expect(saved).toMatchObject({ ok: true });
    expect(String((saved as { message?: string }).message)).toContain("нового календаря");
    expect(colors).toEqual([]);
    await store.save({ ...store.snapshot(), googleCalendarId: "app-calendar-1" });
    const painted = await handleMessage({ type: "saveSettings", settings }, sender, deps);
    expect(painted).toMatchObject({ ok: true });
    expect(String((painted as { message?: string }).message)).toContain("Цвет календаря обновлён");
    expect(colors).toEqual(["16"]);
    await store.save({ ...store.snapshot(), googleCalendarId: "app-calendar-1" });
    const connected = await handleMessage({ type: "connectGoogle" }, sender, deps);
    expect(connected).toMatchObject({ ok: true, code: "google_connected" });
    expect(String((connected as { message?: string }).message)).toContain("Цвет календаря обновлён");
    expect(colors).toEqual(["16", "16"]);
  });

  it("paints an existing calendar when the saved color is sent with the lessons", async () => {
    const week = await snapshot("normal-week");
    const store = createMemoryStore();
    const colors: string[] = [];
    await store.save({
      ...store.snapshot(),
      lastSnapshot: week,
      googleCalendarId: "app-calendar-1",
      settings: { ...store.snapshot().settings, calendarColorId: "16" },
    });
    const api: CalendarApi = {
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
      async setCalendarColor(id, colorId) {
        colors.push(`${id}:${colorId}`);
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
      async getEvent() {
        return { ok: false, code: "missing" };
      },
      async insertEvent() {
        return { ok: true };
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
    const written = await handleMessage({ type: "confirmSync", snapshotHash: week.snapshotHash }, sender, {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
      oauthConfigured: true,
      calendarApi: api,
    });
    expect(written).toMatchObject({ ok: true, code: "sync_written" });
    expect(colors).toEqual(["app-calendar-1:16"]);
  });

  it("cancels only disappeared lessons from a complete snapshot after a separate confirmation", async () => {
    const week = await snapshot("normal-week");
    const first = week.lessons[0];
    if (!first) throw new Error("fixture is missing lessons");
    const store = createMemoryStore();
    const keptKey = `provisional:${"a".repeat(64)}`;
    const movedKey = `provisional:${"b".repeat(64)}`;
    const outsideKey = `provisional:${"c".repeat(64)}`;
    const foreignKey = `provisional:${"d".repeat(64)}`;
    const events: OwnedEvent[] = [
      owned("orphan000000000000000000000001", "etag-orphan", keptKey, week.sourceKey, first.start, first.end),
      owned("moved00000000000000000000000001", "etag-moved", movedKey, week.sourceKey, "2020-01-15T10:00:00+03:00", "2020-01-15T11:30:00+03:00"),
      owned("outside000000000000000000000001", "etag-outside", outsideKey, week.sourceKey, "2020-01-15T10:00:00+03:00", "2020-01-15T11:30:00+03:00"),
      owned("foreign000000000000000000000001", "etag-foreign", foreignKey, "other-source", first.start, first.end),
    ];
    const deleted: string[] = [];
    await store.save({
      ...store.snapshot(),
      lastSnapshot: week,
      googleCalendarId: "app-calendar-1",
      lessonMappings: [{
        lessonKey: movedKey,
        eventId: "moved00000000000000000000000001",
        sourceHash: "e".repeat(64),
        managedHash: "f".repeat(64),
      }],
    });
    const api = calendarApi(events, deleted);
    const deps = {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
      oauthConfigured: true,
      calendarApi: api,
    };
    const partial = { ...week, coverageStatus: "partial" as const };
    await store.save({ ...store.snapshot(), lastSnapshot: partial });
    const blocked = await handleMessage({ type: "confirmCancellations", snapshotHash: partial.snapshotHash }, sender, deps);
    expect(blocked).toMatchObject({ ok: false, code: "snapshot_partial" });
    expect(deleted).toEqual([]);
    await store.save({ ...store.snapshot(), lastSnapshot: week });
    const preview = await handleMessage({ type: "planSync" }, sender, deps);
    expect(String((preview as { message?: string }).message)).toContain("К отмене после отдельного подтверждения: 2");
    expect(preview).toMatchObject({ canCancel: true });
    const written = await handleMessage({ type: "confirmSync", snapshotHash: week.snapshotHash }, sender, deps);
    expect(written).toMatchObject({ ok: true });
    expect(deleted).toEqual([]);
    const removed = await handleMessage({ type: "confirmCancellations", snapshotHash: week.snapshotHash }, sender, deps);
    expect(removed).toMatchObject({ ok: true, code: "cancellations_written" });
    expect(deleted.slice().sort()).toEqual(["moved00000000000000000000000001", "orphan000000000000000000000001"]);
    expect(events.map((item) => item.id).sort()).toEqual(["foreign000000000000000000000001", "outside000000000000000000000001"]);
    expect(store.snapshot().lessonMappings.some((item) => item.lessonKey === movedKey)).toBe(false);
    expect(store.snapshot().lessonMappings).toHaveLength(week.lessons.length);
    const again = await handleMessage({ type: "confirmCancellations", snapshotHash: week.snapshotHash }, sender, deps);
    expect(again).toMatchObject({ ok: true, code: "cancel_none" });
    expect(deleted).toHaveLength(2);
  });

  it("treats an already deleted event as finished and keeps a changed event", async () => {
    const week = await snapshot("normal-week");
    const first = week.lessons[0];
    if (!first) throw new Error("fixture is missing lessons");
    const store = createMemoryStore();
    const goneKey = `provisional:${"a".repeat(64)}`;
    const changedKey = `provisional:${"b".repeat(64)}`;
    const events: OwnedEvent[] = [
      owned("gone00000000000000000000000001", "etag-gone", goneKey, week.sourceKey, first.start, first.end),
      owned("changed000000000000000000000001", "etag-changed", changedKey, week.sourceKey, first.start, first.end),
    ];
    await store.save({
      ...store.snapshot(),
      lastSnapshot: week,
      googleCalendarId: "app-calendar-1",
      lessonMappings: [
        { lessonKey: goneKey, eventId: "gone00000000000000000000000001", sourceHash: "e".repeat(64), managedHash: "f".repeat(64) },
        { lessonKey: changedKey, eventId: "changed000000000000000000000001", sourceHash: "e".repeat(64), managedHash: "f".repeat(64) },
      ],
    });
    const api = calendarApi(events, [], {
      async deleteEvent(_calendarId, eventId) {
        if (eventId === "gone00000000000000000000000001") return { ok: false, code: "missing" };
        return { ok: false, code: "conflict" };
      },
    });
    const result = await handleMessage({ type: "confirmCancellations", snapshotHash: week.snapshotHash }, sender, {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
      oauthConfigured: true,
      calendarApi: api,
    });
    expect(result).toMatchObject({ ok: true, code: "sync_partial" });
    expect(String((result as { message?: string }).message)).toContain("Удалено пар: 1");
    expect(store.snapshot().lessonMappings.map((item) => item.eventId)).toEqual(["changed000000000000000000000001"]);
  });

  it("reuses the only calendar that already contains app events", async () => {
    const week = await snapshot("normal-week");
    const events: OwnedEvent[] = [];
    for (const lesson of week.lessons) {
      const plan = await planLesson(week, lesson);
      events.push({
        id: `event${events.length}`,
        etag: "etag",
        summary: plan.summary,
        location: plan.location,
        description: plan.description,
        start: plan.start,
        end: plan.end,
        timeZone: plan.timeZone,
        lessonKey: plan.lessonKey,
        sourceKey: plan.sourceKey,
        sourceHash: plan.sourceHash,
      });
    }
    const store = createMemoryStore();
    await store.save({ ...store.snapshot(), lastSnapshot: week });
    let created = 0;
    const api = calendarApi(events, [], {
      async listCalendars() {
        return {
          ok: true,
          calendars: [
            { id: "old-calendar", summary: "Расписание вуза" },
            { id: "primary-calendar", summary: "Основной", primary: true },
            { id: "empty-same-name", summary: "Расписание вуза" },
          ],
        };
      },
      async hasAppEvents(id) {
        return { ok: true, found: id === "old-calendar" };
      },
      async createCalendar() {
        created += 1;
        return { ok: true, id: "new-calendar" };
      },
      async insertEvent() {
        throw new Error("event must not be inserted");
      },
    });
    const deps = {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
      oauthConfigured: true,
      calendarApi: api,
    };
    const preview = await handleMessage({ type: "planSync" }, sender, deps);
    expect(preview).toMatchObject({ ok: true, createCalendar: false, canConfirm: false });
    expect(String((preview as { message?: string }).message)).toContain("создать 0");
    expect(store.snapshot().googleCalendarId).toBe("old-calendar");
    const written = await handleMessage({ type: "confirmSync", snapshotHash: week.snapshotHash }, sender, deps);
    expect(written).toMatchObject({ ok: true, code: "sync_unchanged" });
    expect(created).toBe(0);
  });

  it("does not create a calendar when several already contain app events", async () => {
    const week = await snapshot("normal-week");
    const store = createMemoryStore();
    await store.save({ ...store.snapshot(), lastSnapshot: week });
    let created = 0;
    const api = calendarApi([], [], {
      async listCalendars() {
        return {
          ok: true,
          calendars: [
            { id: "old-calendar", summary: "Расписание вуза" },
            { id: "new-calendar", summary: "Расписание вуза" },
          ],
        };
      },
      async hasAppEvents() {
        return { ok: true, found: true };
      },
      async createCalendar() {
        created += 1;
        return { ok: true, id: "third-calendar" };
      },
    });
    const deps = {
      extensionId,
      store,
      getActiveTabUrl: async () => undefined,
      now: () => CAPTURED_AT,
      oauthConfigured: true,
      calendarApi: api,
    };
    const preview = await handleMessage({ type: "planSync" }, sender, deps);
    expect(preview).toMatchObject({ ok: false, code: "several_calendars", canConfirm: false });
    const written = await handleMessage({ type: "confirmSync", snapshotHash: week.snapshotHash }, sender, deps);
    expect(written).toMatchObject({ ok: false, code: "several_calendars" });
    expect(created).toBe(0);
    expect(store.snapshot().googleCalendarId).toBeNull();
  });
});

function owned(id: string, etag: string, lessonKey: string, sourceKey: string, start: string, end: string): OwnedEvent {
  return {
    id,
    etag,
    summary: "Пара",
    location: "",
    description: "",
    start,
    end,
    timeZone: "Europe/Moscow",
    lessonKey,
    sourceKey,
    sourceHash: "ab".repeat(32),
  };
}

function calendarApi(events: OwnedEvent[], deleted: string[], overrides: Partial<CalendarApi> = {}): CalendarApi {
  return {
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
      return { ok: true };
    },
    async releaseLessonColors() {
      return { ok: true };
    },
    async deleteCalendar() {
      throw new Error("calendar must not be deleted");
    },
    async deleteEvent(_calendarId, eventId) {
      deleted.push(eventId);
      const index = events.findIndex((item) => item.id === eventId);
      if (index >= 0) events.splice(index, 1);
      return { ok: true };
    },
    async getEvent() {
      return { ok: false, code: "missing" };
    },
    async insertEvent() {
      return { ok: true };
    },
    async patchEvent() {
      throw new Error("event must not be patched");
    },
    async listOwnedEvents() {
      return { ok: true, events: [...events] };
    },
    async hasAppEvents() {
      return { ok: true, found: false };
    },
    ...overrides,
  };
}
