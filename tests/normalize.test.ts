import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { canonicalStringify } from "../src/domain/canonical";
import { selectDeletionCandidates } from "../src/domain/cancellation";
import { missingRoomLabel, roomLabel } from "../src/domain/normalize";
import { localDateTimeToRfc3339 } from "../src/domain/time";
import { normalize, preview, snapshot } from "./helpers";

const openGate = {
  sourceKeyMatches: true,
  ownershipProven: true,
  explicitUserConfirmation: true,
  eventIds: ["event-1", "event-2"],
};

describe("normalizeSchedule", () => {
  it("keeps a normal week in the university zone and does not merge two subjects", async () => {
    const result = await snapshot("normal-week");
    expect(result.coverageStatus).toBe("complete");
    expect(result.lessons.map((lesson) => lesson.title)).toEqual([
      "Математический анализ",
      "Математический анализ",
      "Базы данных",
      "Алгоритмы",
      "Английский язык",
    ]);
    expect(new Set(result.lessons.map((lesson) => lesson.localIdentity)).size).toBe(5);
    expect(result.lessons.every((lesson) => lesson.identityConfidence === "stable")).toBe(true);
    expect(result.lessons.every((lesson) => lesson.start.endsWith("+03:00") && lesson.end.endsWith("+03:00"))).toBe(true);
    expect(result.lessons.every((lesson) => lesson.timeZone === "Europe/Moscow")).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["missing_room"]);
    expect(roomLabel(result.lessons[2]?.room)).toBe(missingRoomLabel);
  });

  it("accepts an explicitly empty complete period", async () => {
    const result = await snapshot("empty-complete");
    expect(result.lessons).toEqual([]);
    expect(result.coverageStatus).toBe("complete");
    expect(result.warnings).toEqual([]);
  });

  it("downgrades a loading page and ignores a logged-out page", async () => {
    const loading = await snapshot("partial-loading");
    expect(loading.coverageStatus).toBe("partial");
    expect(loading.lessons).toHaveLength(1);
    expect(loading.warnings.some((warning) => warning.code === "page_loading")).toBe(true);
    expect(selectDeletionCandidates({ ...openGate, coverageStatus: loading.coverageStatus })).toEqual([]);

    const loggedOut = await preview("logged-out");
    expect(loggedOut.kind).toBe("unavailable");
    expect(JSON.stringify(loggedOut)).not.toContain("Игнорируемая пара");
    expect(selectDeletionCandidates({ ...openGate, coverageStatus: null })).toEqual([]);
  });

  it("keeps a lesson with a missing room and blocks broken rows", async () => {
    const missing = await snapshot("missing-room");
    expect(missing.coverageStatus).toBe("complete");
    expect(missing.lessons[0]?.room).toBeUndefined();
    expect(roomLabel(missing.lessons[0]?.room)).toBe("Аудитория не указана");

    const invalid = await snapshot("invalid-rows");
    expect(invalid.coverageStatus).toBe("partial");
    expect(invalid.lessons.map((lesson) => lesson.title)).toEqual(["Верная пара"]);
    expect(invalid.warnings.map((warning) => warning.code)).toEqual([
      "missing_title",
      "invalid_time_range",
      "missing_time",
      "rows_blocked",
    ]);
    expect(selectDeletionCandidates({ ...openGate, coverageStatus: "partial" })).toEqual([]);
  });

  it("does not invent a year for an incomplete date", async () => {
    const result = await snapshot("ambiguous-year");
    expect(result.coverageStatus).toBe("partial");
    expect(result.lessons.map((lesson) => lesson.title)).toEqual(["Пара с полной датой"]);
    expect(result.warnings.some((warning) => warning.code === "ambiguous_date")).toBe(true);
    expect(JSON.stringify(result.lessons)).not.toContain("Пара без года");
  });

  it("uses the supplied zone across DST and rejects ambiguous local times", async () => {
    const original = Temporal.Now.timeZoneId;
    Temporal.Now.timeZoneId = () => {
      throw new Error("system timezone must not be read");
    };
    try {
      const winter = localDateTimeToRfc3339("2026-01-15", "09:00", "Europe/Moscow");
      const berlinWinter = localDateTimeToRfc3339("2026-01-15", "09:00", "Europe/Berlin");
      const berlinSummer = localDateTimeToRfc3339("2026-07-15", "09:00", "Europe/Berlin");
      const newYorkWinter = localDateTimeToRfc3339("2026-01-15", "09:00", "America/New_York");
      const newYorkSummer = localDateTimeToRfc3339("2026-07-15", "09:00", "America/New_York");
      expect(winter).toMatchObject({ ok: true, value: "2026-01-15T09:00:00+03:00" });
      expect(berlinWinter).toMatchObject({ ok: true, value: "2026-01-15T09:00:00+01:00" });
      expect(berlinSummer).toMatchObject({ ok: true, value: "2026-07-15T09:00:00+02:00" });
      expect(newYorkWinter).toMatchObject({ ok: true, value: "2026-01-15T09:00:00-05:00" });
      expect(newYorkSummer).toMatchObject({ ok: true, value: "2026-07-15T09:00:00-04:00" });

      const dst = await snapshot("dst-berlin");
      expect(dst.lessons.map((lesson) => [lesson.title, lesson.start])).toEqual([
        ["Зимняя пара", "2026-01-15T09:00:00+01:00"],
        ["Летняя пара", "2026-07-15T09:00:00+02:00"],
      ]);
      expect(dst.coverageStatus).toBe("partial");
      expect(dst.warnings.filter((warning) => warning.code === "invalid_local_time")).toHaveLength(2);
    } finally {
      Temporal.Now.timeZoneId = original;
    }
  });

  it("keeps two same-day subjects apart and blocks indistinguishable rows", async () => {
    const distinct = await snapshot("same-subject-twice");
    expect(distinct.lessons).toHaveLength(2);
    expect(distinct.lessons[0]?.localIdentity).not.toBe(distinct.lessons[1]?.localIdentity);
    expect(distinct.lessons.every((lesson) => lesson.identityConfidence === "ambiguous")).toBe(true);
    expect(distinct.coverageStatus).toBe("unknown");

    const same = await snapshot("indistinguishable");
    expect(same.lessons).toEqual([]);
    expect(same.coverageStatus).toBe("partial");
    expect(same.warnings.some((warning) => warning.code === "indistinguishable_records")).toBe(true);
  });

  it("preserves markup as text and keeps the hash stable", async () => {
    const first = await snapshot("html-title");
    const second = await snapshot("html-title");
    expect(first.lessons[0]?.title).toBe("<img src=x onerror=alert(1)>Дисциплина");
    expect(first.lessons[0]?.room).toBe("<b>404</b>");
    expect(first.snapshotHash).toBe(second.snapshotHash);
    expect(first.snapshotHash).toMatch(/^[a-f0-9]{64}$/);

    const changed = await normalize({
      records: [
        {
          sourceLessonId: "html-1",
          title: "Дисциплина",
          date: "2026-10-13",
          startTime: "09:00",
          endTime: "10:30",
          room: "404",
        },
      ],
    });
    expect(changed.kind).toBe("snapshot");
    if (changed.kind === "snapshot") expect(changed.snapshot.snapshotHash).not.toBe(first.snapshotHash);
  });

  it("accepts a capture timestamp with fractional seconds", async () => {
    const result = await normalize({
      capturedAt: "2026-10-13T09:00:00.123Z",
      records: [
        {
          sourceLessonId: "clock-1",
          title: "Пара",
          date: "2026-10-13",
          startTime: "09:00",
          endTime: "10:30",
          room: "1",
        },
      ],
    });
    expect(result.kind).toBe("snapshot");
    if (result.kind === "snapshot") expect(result.snapshot.lessons).toHaveLength(1);
  });

  it("does not fall back when the zone is missing and blocks duplicate source ids", async () => {
    const missingZone = await normalize({ timeZone: "", records: [] });
    expect(missingZone).toMatchObject({ kind: "unavailable", code: "timezone_missing" });

    const duplicates = await normalize({
      records: [
        { sourceLessonId: "same", title: "Одна", date: "2026-10-13", startTime: "09:00", endTime: "10:00", room: "1" },
        { sourceLessonId: "same", title: "Другая", date: "2026-10-13", startTime: "11:00", endTime: "12:00", room: "2" },
      ],
    });
    expect(duplicates.kind).toBe("snapshot");
    if (duplicates.kind === "snapshot") {
      expect(duplicates.snapshot.lessons).toEqual([]);
      expect(duplicates.snapshot.coverageStatus).toBe("partial");
    }
  });

  it("uses offline when the page has no lesson type and keeps an explicit type", async () => {
    const offline = await normalize({
      groupName: "Группа А-1",
      records: [{ sourceLessonId: "room-1", title: "Пара", date: "2026-10-13", startTime: "09:00", endTime: "10:30", room: "1" }],
    });
    expect(offline.kind).toBe("snapshot");
    if (offline.kind === "snapshot") {
      expect(offline.snapshot.lessons[0]).toMatchObject({ lessonType: "оффлайн", group: "Группа А-1" });
    }

    const webinar = await normalize({
      records: [{ sourceLessonId: "web-1", title: "Пара", date: "2026-10-13", startTime: "09:00", endTime: "10:30", room: "1", lessonType: "вебинар", group: "С сайта" }],
    });
    expect(webinar.kind).toBe("snapshot");
    if (webinar.kind === "snapshot") {
      expect(webinar.snapshot.lessons[0]).toMatchObject({ lessonType: "вебинар", group: "С сайта" });
    }
  });
});

describe("canonicalStringify", () => {
  it("sorts object keys", () => {
    expect(canonicalStringify({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalStringify({ a: { c: 2, d: 1 }, b: 1 }));
  });
});
