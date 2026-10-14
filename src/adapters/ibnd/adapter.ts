import { Temporal } from "@js-temporal/polyfill";
import { normalizeSchedule } from "../../domain/normalize";
import type { ScheduleReadResult } from "../../domain/types";
import {
  IBND_ORIGIN,
  IBND_PARSER_VERSION,
  IBND_SOURCE_KEY,
  IBND_TIME_ZONE,
  type IbndExtractResult,
} from "./extract";

const EMPTY_DAYS_WARNING = {
  code: "empty_days_omitted",
  message: "Дни без пар в таблице не показаны. Если пара исчезла с сайта, она снята или перенесена на другое время.",
};

export function canHandleIbnd(url: string): boolean {
  try {
    return new URL(url).origin === IBND_ORIGIN;
  } catch {
    return false;
  }
}

export async function snapshotFromIbndExtract(
  extract: IbndExtractResult,
  capturedAt: string,
  timeZone: string,
  groupName = "",
): Promise<ScheduleReadResult> {
  if (extract.status === "inject_failed") {
    return unavailable("inject_failed", "Не удалось прочитать вкладку. Откройте страницу расписания и повторите.");
  }
  if (extract.status === "missing_table") {
    return unavailable(
      "missing_table",
      "На этой странице нет таблицы расписания. Откройте список занятий на stud.ibnd.ru.",
    );
  }
  if (extract.status !== "ready" || !extract.firstDate || !extract.lastDate) {
    return unavailable(
      "empty_table",
      "Таблица расписания пуста. Это не считается полным семестром, и занятия из календаря не предлагаются к удалению.",
    );
  }

  return normalizeSchedule({
    sourceKey: IBND_SOURCE_KEY,
    parserVersion: IBND_PARSER_VERSION,
    timeZone: timeZone || IBND_TIME_ZONE,
    capturedAt,
    pageState: "ready",
    coverage: {
      startDate: extract.firstDate,
      endDateExclusive: nextCivilDate(extract.lastDate),
      status: "complete",
    },
    records: extract.records,
    extraWarnings: [EMPTY_DAYS_WARNING],
    groupName,
  });
}

function unavailable(code: string, message: string): ScheduleReadResult {
  return { kind: "unavailable", code, message, coverageStatus: "unknown" };
}

function nextCivilDate(isoDate: string): string {
  return Temporal.PlainDate.from(isoDate).add({ days: 1 }).toString();
}
