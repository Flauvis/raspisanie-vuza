import { isCivilDate, isValidTimeZone } from "../domain/time";
import type { CoverageStatus, PageState, RawLessonRecord } from "../domain/types";

export interface FixtureFile {
  id: string;
  title: string;
  description: string;
  sourceKey: string;
  parserVersion: string;
  timeZone: string;
  pageState: PageState;
  coverage: {
    startDate: string;
    endDateExclusive: string;
    status: CoverageStatus;
  };
  records: RawLessonRecord[];
}

const PAGE_STATES = new Set<PageState>(["ready", "loading", "logged_out", "not_configured"]);
const COVERAGE = new Set<CoverageStatus>(["complete", "partial", "unknown"]);

export function parseFixture(value: unknown): FixtureFile {
  if (!value || typeof value !== "object") throw new Error("fixture_not_object");
  const source = value as Record<string, unknown>;
  const id = requiredText(source.id, "id");
  const title = requiredText(source.title, "title");
  const description = requiredText(source.description, "description");
  const sourceKey = requiredText(source.sourceKey, "sourceKey");
  const parserVersion = requiredText(source.parserVersion, "parserVersion");
  const timeZone = requiredText(source.timeZone, "timeZone");
  const pageState = requiredText(source.pageState, "pageState");
  if (!PAGE_STATES.has(pageState as PageState)) throw new Error("fixture_page_state");
  if (!isValidTimeZone(timeZone)) throw new Error("fixture_timezone");
  if (!source.coverage || typeof source.coverage !== "object") throw new Error("fixture_coverage");
  const coverage = source.coverage as Record<string, unknown>;
  const startDate = requiredText(coverage.startDate, "startDate");
  const endDateExclusive = requiredText(coverage.endDateExclusive, "endDateExclusive");
  const status = requiredText(coverage.status, "status");
  if (!isCivilDate(startDate) || !isCivilDate(endDateExclusive)) throw new Error("fixture_dates");
  if (!COVERAGE.has(status as CoverageStatus)) throw new Error("fixture_coverage_status");
  if (!Array.isArray(source.records)) throw new Error("fixture_records");
  return {
    id,
    title,
    description,
    sourceKey,
    parserVersion,
    timeZone,
    pageState: pageState as PageState,
    coverage: { startDate, endDateExclusive, status: status as CoverageStatus },
    records: source.records.map(parseRecord),
  };
}

function parseRecord(value: unknown): RawLessonRecord {
  if (!value || typeof value !== "object") throw new Error("fixture_record");
  const source = value as Record<string, unknown>;
  return {
    ...optionalText(source, "sourceLessonId"),
    ...optionalText(source, "title"),
    ...optionalText(source, "date"),
    ...optionalText(source, "startTime"),
    ...optionalText(source, "endTime"),
    ...optionalText(source, "room"),
    ...optionalText(source, "teacher"),
    ...optionalText(source, "group"),
    ...optionalText(source, "lessonType"),
    ...optionalText(source, "building"),
  };
}

function optionalText(source: Record<string, unknown>, key: keyof RawLessonRecord): Partial<RawLessonRecord> {
  if (!(key in source) || source[key] === undefined) return {};
  const value = source[key];
  if (typeof value !== "string") throw new Error(`fixture_${key}`);
  return { [key]: value };
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`fixture_${field}`);
  return value.trim();
}
