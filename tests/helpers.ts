import { previewFixture } from "../src/adapters/mock/adapter";
import { getFixture } from "../src/adapters/mock/catalog";
import type { FixtureFile } from "../src/adapters/fixture";
import type { NormalizeInput, ScheduleReadResult, ScheduleSnapshot } from "../src/domain/types";
import { normalizeSchedule } from "../src/domain/normalize";

export const CAPTURED_AT = "2026-10-13T09:00:00Z";

export function fixture(id: string): FixtureFile {
  const found = getFixture(id);
  if (!found) throw new Error(`missing_fixture:${id}`);
  return found;
}

export function preview(id: string): Promise<ScheduleReadResult> {
  return previewFixture(fixture(id), CAPTURED_AT);
}

export async function snapshot(id: string): Promise<ScheduleSnapshot> {
  const result = await preview(id);
  if (result.kind !== "snapshot") throw new Error(`expected_snapshot:${id}:${result.code}`);
  return result.snapshot;
}

export function normalize(input: Partial<NormalizeInput> & Pick<NormalizeInput, "records">): Promise<ScheduleReadResult> {
  return normalizeSchedule({
    sourceKey: "mock:group-a",
    parserVersion: "mock-1.0.0",
    timeZone: "Europe/Moscow",
    capturedAt: CAPTURED_AT,
    pageState: "ready",
    coverage: {
      startDate: "2026-10-13",
      endDateExclusive: "2026-10-14",
      status: "complete",
    },
    ...input,
    records: input.records,
  });
}
