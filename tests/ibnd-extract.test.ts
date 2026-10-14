/** @vitest-environment happy-dom */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotFromIbndExtract } from "../src/adapters/ibnd/adapter";
import { extractIbndSchedule, IBND_TIME_ZONE } from "../src/adapters/ibnd/extract";
import { CAPTURED_AT } from "./helpers";

const html = readFileSync(resolve("tests/fixtures/ibnd-week.html"), "utf8");

function readFixture(): ReturnType<typeof extractIbndSchedule> {
  document.body.innerHTML = html;
  return extractIbndSchedule(document);
}

describe("IBND schedule table", () => {
  it("reads the confirmed lesson, a webinar and two subjects on one day", async () => {
    const extracted = readFixture();
    expect(extracted.status).toBe("ready");
    expect(JSON.stringify(extracted)).not.toContain("example.invalid");
    expect(JSON.stringify(extracted)).not.toContain("://");
    expect(extractIbndSchedule.toString()).toContain("table.table-schedule");
    expect(extractIbndSchedule.toString()).toContain("parseHeaderDate");
    expect(extractIbndSchedule.toString()).not.toContain("snapshotFromIbndExtract");

    const result = await snapshotFromIbndExtract(extracted, CAPTURED_AT, IBND_TIME_ZONE);
    expect(result.kind).toBe("snapshot");
    if (result.kind !== "snapshot") return;
    const lesson = result.snapshot.lessons.find((item) => item.title === "Нарративный дизайн");
    expect(lesson).toMatchObject({
      sourceDate: "2026-09-02",
      start: "2026-09-02T15:40:00+03:00",
      end: "2026-09-02T17:10:00+03:00",
      room: "236",
      teacher: "Преподаватель 1",
      timeZone: "Europe/Moscow",
      lessonType: "оффлайн",
      identityConfidence: "ambiguous",
    });
    expect(lesson?.sourceLessonId).toBeUndefined();

    const webinar = result.snapshot.lessons.find((item) => item.title === "Компьютерные технологии");
    expect(webinar).toMatchObject({ room: "205", lessonType: "вебинар", teacher: "Преподаватель 4" });

    const programming = result.snapshot.lessons.filter((item) => item.title === "Языки программирования" && item.sourceDate === "2026-09-04");
    expect(programming).toHaveLength(2);
    expect(programming[0]?.localIdentity).not.toBe(programming[1]?.localIdentity);

    const creative = result.snapshot.lessons.find((item) => item.title === "Креативное мышление");
    expect(creative?.teacher).toBe("Преподаватель 3");

    expect(result.snapshot.lessons.some((item) => item.title === "Неверная дата")).toBe(false);
    expect(result.snapshot.coverage).toEqual({
      startDate: "2026-09-02",
      endDateExclusive: "2026-09-08",
      timeZone: "Europe/Moscow",
    });
    expect(result.snapshot.coverageStatus).toBe("partial");
    expect(result.snapshot.warnings.some((warning) => warning.code === "missing_room")).toBe(true);
    expect(result.snapshot.warnings.some((warning) => warning.code === "ambiguous_date")).toBe(true);
    expect(result.snapshot.warnings.some((warning) => warning.code === "empty_days_omitted")).toBe(true);
  });

  it("does not treat a page without the schedule table as an empty semester", async () => {
    document.body.innerHTML = "<main><p>Секретная пара 09:00</p></main>";
    const extracted = extractIbndSchedule(document);
    expect(extracted.status).toBe("missing_table");
    expect(JSON.stringify(extracted)).not.toContain("Секретная");
    const result = await snapshotFromIbndExtract(extracted, CAPTURED_AT, IBND_TIME_ZONE);
    expect(result).toMatchObject({ kind: "unavailable", code: "missing_table" });
  });

  it("parses a single-digit day and keeps a complete table complete", async () => {
    document.body.innerHTML = `<table class="table table-schedule"><tbody>
      <tr class="row row-header"><td colspan="3"><h4>Пн, 2.11.2026</h4></td></tr>
      <tr class="row"><td class="time-cell">10:00<br>11:30</td><td class="discipline-cell">Игровой баланс<br><span class="teacherfio">Преподаватель 1</span></td><td class="room-cell">414</td></tr>
    </tbody></table>`;
    const result = await snapshotFromIbndExtract(extractIbndSchedule(document), CAPTURED_AT, IBND_TIME_ZONE);
    expect(result.kind).toBe("snapshot");
    if (result.kind !== "snapshot") return;
    expect(result.snapshot.coverageStatus).toBe("complete");
    expect(result.snapshot.lessons[0]).toMatchObject({
      sourceDate: "2026-11-02",
      start: "2026-11-02T10:00:00+03:00",
      lessonType: "оффлайн",
    });
  });

  it("reads the saved semester file when it is present on this computer", async () => {
    const personalPath = "C:/Users/ppolo/Documents/schedule.html";
    if (!existsSync(personalPath)) return;
    document.body.innerHTML = readFileSync(personalPath, "utf8");
    const extracted = extractIbndSchedule(document);
    expect(extracted.status).toBe("ready");
    expect(JSON.stringify(extracted)).not.toContain("http");
    expect(JSON.stringify(extracted)).not.toContain("mts-link");
    const result = await snapshotFromIbndExtract(extracted, CAPTURED_AT, IBND_TIME_ZONE);
    expect(result.kind).toBe("snapshot");
    if (result.kind !== "snapshot") return;
    const lesson = result.snapshot.lessons.find(
      (item) => item.title === "Нарративный дизайн" && item.sourceDate === "2026-10-14" && item.room === "236",
    );
    expect(lesson?.start).toBe("2026-10-14T15:40:00+03:00");
    expect(lesson?.end).toBe("2026-10-14T17:10:00+03:00");
    expect(result.snapshot.coverage.startDate).toBe("2026-10-13");
    expect(result.snapshot.coverage.endDateExclusive).toBe("2026-12-20");
    expect(result.snapshot.coverageStatus).toBe("complete");
    expect(result.snapshot.lessons.length).toBeGreaterThan(50);
  });
});
