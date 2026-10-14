import type { CoverageStatus } from "./types";

export interface CancellationGate {
  coverageStatus: CoverageStatus | null;
  sourceKeyMatches: boolean;
  ownershipProven: boolean;
  explicitUserConfirmation: boolean;
}

export function canProposeCancellations(input: CancellationGate): boolean {
  return (
    input.coverageStatus === "complete" &&
    input.sourceKeyMatches &&
    input.ownershipProven &&
    input.explicitUserConfirmation
  );
}

export function selectDeletionCandidates(input: CancellationGate & { eventIds: readonly string[] }): readonly string[] {
  if (!canProposeCancellations(input)) return [];
  return [...input.eventIds];
}

export function cancellationNote(coverageStatus: CoverageStatus | null): string {
  if (coverageStatus === null) {
    return "Источник недоступен. События календаря не изменяются и не отменяются.";
  }
  if (coverageStatus !== "complete") {
    return "Снимок не является полным. Возможные отмены не формируются.";
  }
  return "Снимок периода полный. Сравнение может предложить отмены, но они выполняются только отдельным подтверждением.";
}
