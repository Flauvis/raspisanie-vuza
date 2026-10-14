import { IBND_ORIGIN, IBND_TIME_ZONE } from "../adapters/ibnd/extract";
import { pathAllowed } from "./settings";
import type { AppStatus } from "./types";

export const LIVE_PAGE_READ_ENABLED = true;

export interface ReadRequest {
  timeZone: string;
  sourceOrigin: string;
  sourcePathPrefix: string;
  tabUrl: string | undefined;
  adapterConfiguredForUrl: boolean;
}

export type ReadDecision =
  | { action: "block"; status: AppStatus; code: string; message: string }
  | { action: "read"; status: "reading"; code: "read"; message: string };

export function evaluateReadRequest(input: ReadRequest): ReadDecision {
  const tabOrigin = originOf(input.tabUrl);
  const sourceOrigin = input.sourceOrigin.trim() || (tabOrigin === IBND_ORIGIN ? IBND_ORIGIN : "");
  const timeZone = input.timeZone.trim() || (sourceOrigin === IBND_ORIGIN ? IBND_TIME_ZONE : "");

  if (!timeZone) {
    return block(
      "not_configured",
      "timezone_missing",
      "Укажите часовой пояс вуза в настройках. Часовой пояс компьютера не используется.",
    );
  }
  if (!sourceOrigin) {
    return block(
      "not_configured",
      "origin_missing",
      "Сайт расписания не настроен. Чтение страницы заблокировано. Можно открыть тестовый предпросмотр.",
    );
  }
  if (!input.tabUrl) {
    return block("error", "tab_unavailable", "Не удалось получить адрес активной вкладки. Страница не читалась.");
  }

  let url: URL;
  try {
    url = new URL(input.tabUrl);
  } catch {
    return block("error", "tab_url_invalid", "Адрес активной вкладки не распознан. Страница не читалась.");
  }
  if (url.origin !== sourceOrigin) {
    return block(
      "error",
      "origin_mismatch",
      "Активная вкладка не совпадает с настроенным сайтом. Чтение не запускалось.",
    );
  }
  if (!pathAllowed(url.pathname, input.sourcePathPrefix)) {
    return block(
      "error",
      "path_mismatch",
      "Путь страницы не входит в разрешённый префикс. Чтение не запускалось.",
    );
  }
  if (!input.adapterConfiguredForUrl) {
    return block(
      "not_configured",
      "adapter_not_configured",
      "Для этого сайта разметка расписания не настроена. Страница не читается.",
    );
  }
  if (!LIVE_PAGE_READ_ENABLED) {
    return block("not_configured", "live_read_disabled", "Чтение живой страницы на этом этапе отключено.");
  }
  return {
    action: "read",
    status: "reading",
    code: "read",
    message: "Чтение таблицы расписания.",
  };
}

function originOf(tabUrl: string | undefined): string {
  if (!tabUrl) return "";
  try {
    return new URL(tabUrl).origin;
  } catch {
    return "";
  }
}

function block(status: AppStatus, code: string, message: string): ReadDecision {
  return { action: "block", status, code, message };
}
