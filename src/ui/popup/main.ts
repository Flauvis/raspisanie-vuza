import { signInFromUserGesture } from "../../background/google-auth";
import { OAUTH_CLIENT_CONFIGURED } from "../../calendar/oauth-config";
import { evaluateReadRequest } from "../../domain/read-gate";
import { deriveStatus, STATUS_LABELS } from "../../domain/status";
import { formatInstantInZone } from "../../domain/time";
import type { AppState } from "../../domain/types";
import { createBrowserStore, hasChromeExtensionApis } from "../../storage/browser-store";
import { requireElement, setText } from "../shared/dom";
import { watchUpdate } from "../shared/update-notice";
import { applyTheme, readBootTheme } from "../shared/theme";
import "../shared/app.css";

applyTheme(readBootTheme());
const store = createBrowserStore();
const statusNode = requireElement<HTMLElement>("status");
const timezoneNode = requireElement<HTMLElement>("timezone");
const originNode = requireElement<HTMLElement>("origin");
const googleNode = requireElement<HTMLElement>("google");
const lastCheckNode = requireElement<HTMLElement>("last-check");
const lastWriteNode = requireElement<HTMLElement>("last-write");
const messageNode = requireElement<HTMLElement>("message");
const devBanner = requireElement<HTMLParagraphElement>("dev-banner");

if (!hasChromeExtensionApis()) {
  devBanner.hidden = false;
  setText(devBanner, "Окно открыто вне расширения. Чтение вкладки доступно после установки сборки в Chrome.");
}

requireElement<HTMLButtonElement>("read").addEventListener("click", () => {
  void readSchedule();
});
requireElement<HTMLButtonElement>("preview").addEventListener("click", () => {
  openExtensionPage("src/ui/review/index.html");
});
const connectButton = requireElement<HTMLButtonElement>("connect");
connectButton.disabled = !hasChromeExtensionApis() || !OAUTH_CLIENT_CONFIGURED;
connectButton.addEventListener("click", () => {
  if (connectButton.disabled) return;
  setText(messageNode, "Открываю окно Google…");
  connectButton.disabled = true;
  signInFromUserGesture((ok) => {
    if (!ok) {
      connectButton.disabled = !OAUTH_CLIENT_CONFIGURED;
      setText(messageNode, "Google не выдал доступ. Проверьте Test users и нажмите «Подключить Google» ещё раз.");
      return;
    }
    void connectGoogle();
  });
});
requireElement<HTMLButtonElement>("options").addEventListener("click", () => {
  if (hasChromeExtensionApis()) {
    chrome.runtime.openOptionsPage();
    return;
  }
  window.location.href = "../options/index.html";
});

void refresh();
watchUpdate();

async function refresh(): Promise<void> {
  const state = await store.load();
  applyTheme(state.settings.theme, true);
  paint(state);
}

function paint(state: AppState, message = state.lastRead?.message ?? "Откройте расписание на stud.ibnd.ru и нажмите «Считать расписание». Запись в календарь выключена."): void {
  const status = deriveStatus(state, false);
  setText(statusNode, STATUS_LABELS[status]);
  statusNode.dataset.status = status;
  setText(timezoneNode, state.settings.timeZone || "Не задан");
  setText(originNode, state.settings.sourceOrigin || "Не настроен");
  setText(googleNode, state.googleConnected ? "Подключено" : "Не подключено");
  setText(lastCheckNode, state.lastCheckAt ? formatInstantInZone(state.lastCheckAt, state.settings.timeZone) : "Ещё не было");
  setText(lastWriteNode, state.lastSuccessfulWriteAt ? formatInstantInZone(state.lastSuccessfulWriteAt, state.settings.timeZone) : "Ещё не было");
  setText(messageNode, message);
}

async function connectGoogle(): Promise<void> {
  if (!hasChromeExtensionApis()) return;
  const response = await chrome.runtime.sendMessage({ type: "connectGoogle" });
  connectButton.disabled = !OAUTH_CLIENT_CONFIGURED;
  const state = await store.load();
  paint(state, textField(response, "message") ?? "Google не подключён.");
}

async function readSchedule(): Promise<void> {
  if (hasChromeExtensionApis()) {
    const response = await chrome.runtime.sendMessage({ type: "readActiveTab" });
    const state = await store.load();
    paint(state, textField(response, "message") ?? "Чтение не выполнено.");
    if (response && typeof response === "object" && "ok" in response && response.ok === true) {
      openExtensionPage("src/ui/review/index.html");
    }
    return;
  }
  const state = await store.load();
  const decision = evaluateReadRequest({
    timeZone: state.settings.timeZone,
    sourceOrigin: state.settings.sourceOrigin,
    sourcePathPrefix: state.settings.sourcePathPrefix,
    tabUrl: undefined,
    adapterConfiguredForUrl: false,
  });
  const checkedAt = new Date().toISOString();
  const next: AppState = {
    ...state,
    lastCheckAt: checkedAt,
    lastRead: { code: decision.code, message: decision.message, at: checkedAt },
  };
  await store.save(next);
  paint(next, decision.message);
}

function openExtensionPage(path: string): void {
  if (hasChromeExtensionApis()) {
    chrome.tabs.create({ url: chrome.runtime.getURL(path) });
    return;
  }
  window.location.href = path.endsWith("review/index.html") ? "../review/index.html" : "../options/index.html";
}

function textField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}
