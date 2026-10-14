import type { ScheduleReadResult } from "../../domain/types";
import { canHandleIbnd } from "../ibnd/adapter";

export const realUniversityAdapter = {
  id: "ibnd",
  configured: true,
  canHandle(url: string): boolean {
    return canHandleIbnd(url);
  },
  read(_url: string, _capturedAt: string): Promise<ScheduleReadResult> {
    return Promise.resolve({
      kind: "unavailable",
      code: "missing_table",
      message: "Таблица расписания читается только с открытой вкладки stud.ibnd.ru.",
      coverageStatus: "unknown",
    });
  },
};
