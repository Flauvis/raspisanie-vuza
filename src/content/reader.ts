export interface PageReadFailure {
  status: "not_configured";
  code: "adapter_not_configured";
  message: string;
}

export function readPageFailClosed(_document: Document): PageReadFailure {
  return {
    status: "not_configured",
    code: "adapter_not_configured",
    message: "Реальный адаптер не настроен. Разметка страницы не читается.",
  };
}
