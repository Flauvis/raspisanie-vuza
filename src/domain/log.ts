export function logTechnical(event: { code: string; count?: number; operationId?: string }): void {
  console.info(
    JSON.stringify({
      code: event.code,
      count: event.count ?? 0,
      operationId: event.operationId ?? "",
    }),
  );
}
