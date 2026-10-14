import { cancellationNote } from "../../domain/cancellation";
import { roomLabel } from "../../domain/normalize";
import { formatCivilDate, formatRfc3339 } from "../../domain/time";
import type { IdentityConfidence, ScheduleReadResult } from "../../domain/types";

export interface ReviewTableRow {
  title: string;
  date: string;
  start: string;
  end: string;
  room: string;
  teacher: string;
  group: string;
  lessonType: string;
  identity: string;
}

export interface ReviewView {
  kind: "snapshot" | "unavailable";
  coverageText: string;
  coverageStatusLabel: string;
  timeZone: string;
  warnings: string[];
  rows: ReviewTableRow[];
  cancellationNote: string;
  snapshotHash: string | null;
  emptyText: string;
}

const COVERAGE_LABELS = {
  complete: "Полный период",
  partial: "Частичный снимок",
  unknown: "Полнота неизвестна",
} as const;

export function toReviewView(result: ScheduleReadResult): ReviewView {
  if (result.kind === "unavailable") {
    return {
      kind: "unavailable",
      coverageText: "Период не определён",
      coverageStatusLabel: "Источник недоступен",
      timeZone: "Не применяется",
      warnings: [result.message],
      rows: [],
      cancellationNote: cancellationNote(null),
      snapshotHash: null,
      emptyText: "Занятия не прочитаны.",
    };
  }

  const { snapshot } = result;
  return {
    kind: "snapshot",
    coverageText: `${formatCivilDate(snapshot.coverage.startDate)} — ${formatCivilDate(snapshot.coverage.endDateExclusive)} не включая конец`,
    coverageStatusLabel: COVERAGE_LABELS[snapshot.coverageStatus],
    timeZone: snapshot.coverage.timeZone,
    warnings: snapshot.warnings.map((warning) => warning.message),
    rows: snapshot.lessons.map((lesson) => ({
      title: lesson.title,
      date: formatCivilDate(lesson.sourceDate),
      start: formatRfc3339(lesson.start),
      end: formatRfc3339(lesson.end),
      room: roomLabel(lesson.room),
      teacher: lesson.teacher ?? "—",
      group: lesson.group ?? "—",
      lessonType: lesson.lessonType ?? "—",
      identity: identityLabel(lesson.identityConfidence),
    })),
    cancellationNote: cancellationNote(snapshot.coverageStatus),
    snapshotHash: snapshot.snapshotHash,
    emptyText: "В этом наборе нет занятий, которые прошли проверку.",
  };
}

function identityLabel(confidence: IdentityConfidence): string {
  if (confidence === "stable") return "Стабильный ID";
  if (confidence === "confirmed") return "Связь подтверждена";
  return "Нет стабильного ID";
}
