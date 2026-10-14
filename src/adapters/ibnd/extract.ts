import type { RawLessonRecord } from "../../domain/types";

export const IBND_ORIGIN = "https://stud.ibnd.ru";
export const IBND_TIME_ZONE = "Europe/Moscow";
export const IBND_SOURCE_KEY = "ibnd:schedule";
export const IBND_PARSER_VERSION = "ibnd-schedule-1";

export type IbndExtractStatus = "ready" | "missing_table" | "empty" | "inject_failed";

export interface IbndExtractResult {
  status: IbndExtractStatus;
  records: RawLessonRecord[];
  firstDate?: string;
  lastDate?: string;
}

export function extractIbndSchedule(root?: ParentNode): IbndExtractResult {
  const headerDate = /^(?:Пн|Вт|Ср|Чт|Пт|Сб|Вс),\s*(\d{1,2})\.(\d{2})\.(\d{4})$/;

  const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

  const parseHeaderDate = (value: string): string | null => {
    const match = headerDate.exec(collapse(value));
    if (!match?.[1] || !match[2] || !match[3]) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (month < 1 || month > 12 || year < 2000 || year > 2100) return null;
    const monthLengths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let limit = monthLengths[month] ?? 0;
    if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) limit = 29;
    if (day < 1 || day > limit) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const linesOf = (cell: Element): string[] => {
    const lines: string[] = [];
    let buffer = "";
    const flush = (): void => {
      const text = collapse(buffer);
      if (text) lines.push(text);
      buffer = "";
    };
    const visit = (node: Node): void => {
      if (node.nodeType === 3) {
        buffer += node.textContent ?? "";
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node as Element;
      if (element.tagName === "BR") {
        flush();
        return;
      }
      for (const child of element.childNodes) visit(child);
    };
    for (const child of cell.childNodes) visit(child);
    flush();
    return lines;
  };

  const disciplineParts = (cell: Element): { title?: string; teacher?: string } => {
    const teacherNode = cell.querySelector("span.teacherfio");
    const teacher = collapse(teacherNode?.textContent ?? "");
    const chunks: string[] = [];
    const visit = (node: Node): void => {
      if (teacherNode && (node === teacherNode || teacherNode.contains(node))) return;
      if (node.nodeType === 3) {
        chunks.push(node.textContent ?? "");
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node as Element;
      if (element.tagName === "BR") {
        chunks.push(" ");
        return;
      }
      for (const child of element.childNodes) visit(child);
    };
    for (const child of cell.childNodes) visit(child);
    const title = collapse(chunks.join(""));
    return {
      ...(title ? { title } : {}),
      ...(teacher ? { teacher } : {}),
    };
  };

  const roomParts = (cell: Element): { room?: string; lessonType?: string } => {
    const lines = linesOf(cell);
    const first = lines[0];
    if (!first) return {};
    if (first.toLowerCase() === "webinar") {
      const room = lines[1];
      return { lessonType: "вебинар", ...(room ? { room } : {}) };
    }
    return { room: lines.join(" ") };
  };

  const scope = root ?? globalThis.document;
  const table = scope.querySelector("table.table-schedule");
  if (!table) return { status: "missing_table", records: [] };

  const records: RawLessonRecord[] = [];
  let currentDate: string | null = null;
  let firstDate: string | undefined;
  let lastDate: string | undefined;
  let sawLesson = false;

  for (const row of table.querySelectorAll("tr")) {
    if (row.classList.contains("row-header")) {
      const heading = row.querySelector("h4");
      const parsed = parseHeaderDate(heading?.textContent ?? "");
      currentDate = parsed;
      if (parsed) {
        if (!firstDate || parsed < firstDate) firstDate = parsed;
        if (!lastDate || parsed > lastDate) lastDate = parsed;
      }
      continue;
    }

    const timeCell = row.querySelector("td.time-cell");
    const disciplineCell = row.querySelector("td.discipline-cell");
    const roomCell = row.querySelector("td.room-cell");
    if (!timeCell || !disciplineCell || !roomCell) continue;
    sawLesson = true;
    const times = linesOf(timeCell);
    const discipline = disciplineParts(disciplineCell);
    const place = roomParts(roomCell);
    records.push({
      ...(currentDate ? { date: currentDate } : {}),
      ...(discipline.title ? { title: discipline.title } : {}),
      ...(times[0] ? { startTime: times[0] } : {}),
      ...(times[1] ? { endTime: times[1] } : {}),
      ...(place.room ? { room: place.room } : {}),
      ...(discipline.teacher ? { teacher: discipline.teacher } : {}),
      ...(place.lessonType ? { lessonType: place.lessonType } : {}),
    });
  }

  if (!sawLesson || !firstDate || !lastDate) return { status: "empty", records: [] };
  return { status: "ready", records, firstDate, lastDate };
}

export function sanitizeIbndExtract(value: unknown): IbndExtractResult {
  if (!value || typeof value !== "object") return { status: "inject_failed", records: [] };
  const source = value as Record<string, unknown>;
  const status = source.status;
  if (status !== "ready" && status !== "missing_table" && status !== "empty" && status !== "inject_failed") {
    return { status: "inject_failed", records: [] };
  }
  if (status !== "ready" || !Array.isArray(source.records)) return { status, records: [] };
  const records = source.records.slice(0, 2000).flatMap((record) => {
    const sanitized = sanitizeRecord(record);
    return Object.keys(sanitized).length > 0 ? [sanitized] : [];
  });
  const firstDate = plain(source.firstDate, 10);
  const lastDate = plain(source.lastDate, 10);
  return {
    status: "ready",
    records,
    ...(firstDate ? { firstDate } : {}),
    ...(lastDate ? { lastDate } : {}),
  };
}

function sanitizeRecord(value: unknown): RawLessonRecord {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const date = plain(source.date, 10);
  const title = plain(source.title, 200);
  const startTime = plain(source.startTime, 5);
  const endTime = plain(source.endTime, 5);
  const room = plain(source.room, 40);
  const teacher = plain(source.teacher, 200);
  const lessonType = plain(source.lessonType, 40);
  return {
    ...(date ? { date } : {}),
    ...(title ? { title } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(room ? { room } : {}),
    ...(teacher ? { teacher } : {}),
    ...(lessonType ? { lessonType } : {}),
  };
}

function plain(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > maxLength || text.includes("://")) return undefined;
  return text;
}
