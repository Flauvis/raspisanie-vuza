import { normalizeSchedule } from "../../domain/normalize";
import type { ScheduleReadResult } from "../../domain/types";
import type { FixtureFile } from "../fixture";
import { getFixture } from "./catalog";

export const MOCK_FIXTURE_PREFIX = "mock://fixture/";

export const mockUniversityAdapter = {
  id: "mock",
  configured: true,
  canHandle(url: string): boolean {
    return url.startsWith(MOCK_FIXTURE_PREFIX) && Boolean(getFixture(url.slice(MOCK_FIXTURE_PREFIX.length)));
  },
  read(url: string, capturedAt: string): Promise<ScheduleReadResult> {
    const fixture = getFixture(url.slice(MOCK_FIXTURE_PREFIX.length));
    if (!fixture) {
      return Promise.resolve({
        kind: "unavailable",
        code: "unknown_fixture",
        message: "Тестовый набор не найден.",
        coverageStatus: "unknown",
      });
    }
    return previewFixture(fixture, capturedAt);
  },
};

export function previewFixture(fixture: FixtureFile, capturedAt: string): Promise<ScheduleReadResult> {
  return normalizeSchedule({
    sourceKey: fixture.sourceKey,
    parserVersion: fixture.parserVersion,
    timeZone: fixture.timeZone,
    capturedAt,
    pageState: fixture.pageState,
    coverage: fixture.coverage,
    records: fixture.records,
  });
}
