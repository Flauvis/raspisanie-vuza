import type { AppState, AppStatus } from "./types";

export const STATUS_LABELS: Record<AppStatus, string> = {
  not_configured: "Не настроено",
  ready: "Готово к чтению",
  reading: "Чтение",
  review_required: "Нужна проверка",
  syncing: "Синхронизация",
  partial_success: "Частичный успех",
  success: "Запись выполнена",
  source_unavailable: "Источник недоступен",
  auth_required: "Нужна авторизация",
  error: "Ошибка",
};

const READ_ERROR_CODES = new Set(["tab_unavailable", "tab_url_invalid", "origin_mismatch", "path_mismatch"]);

export function deriveStatus(state: AppState, liveReadAvailable: boolean): AppStatus {
  if (state.lastSnapshot) return "review_required";
  if (state.lastRead && READ_ERROR_CODES.has(state.lastRead.code)) return "error";
  if (state.lastRead?.code === "logged_out") return "source_unavailable";
  if (!state.settings.timeZone || !state.settings.sourceOrigin || !liveReadAvailable) return "not_configured";
  return "ready";
}
