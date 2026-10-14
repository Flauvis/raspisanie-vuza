import { ensureAuthTokenFromGesture, signInFromUserGesture } from "../../background/google-auth";
import { CALENDAR_COLORS } from "../../calendar/colors";
import { OAUTH_CLIENT_CONFIGURED } from "../../calendar/oauth-config";
import { validateSettings } from "../../domain/settings";
import { defaultAppState } from "../../storage/state";
import { createBrowserStore, hasChromeExtensionApis } from "../../storage/browser-store";
import { requireElement, setText, el, clear } from "../shared/dom";
import { watchUpdate } from "../shared/update-notice";
import { applyTheme, readBootTheme } from "../shared/theme";
import type { ThemeId } from "../../domain/types";
import "../shared/app.css";

applyTheme(readBootTheme());
const store = createBrowserStore();
const form = requireElement<HTMLFormElement>("settings");
const timezone = requireElement<HTMLInputElement>("timezone");
const profile = requireElement<HTMLInputElement>("profile");
const group = requireElement<HTMLInputElement>("group");
const origin = requireElement<HTMLInputElement>("origin");
const path = requireElement<HTMLInputElement>("path");
const openCalendar = requireElement<HTMLInputElement>("open-calendar");
const themeLight = requireElement<HTMLInputElement>("theme-light");
const themeDark = requireElement<HTMLInputElement>("theme-dark");
const themeYellow = requireElement<HTMLInputElement>("theme-yellow");
let theme: ThemeId = "light";
bindTheme(themeLight, "light");
bindTheme(themeDark, "dark");
bindTheme(themeYellow, "yellow");
const calendarColors = requireElement<HTMLDivElement>("calendar-colors");
let calendarColorId = "";
let calendarListReady = false;
const settingsMessage = requireElement<HTMLParagraphElement>("settings-message");
const clearMessage = requireElement<HTMLParagraphElement>("clear-message");
const devBanner = requireElement<HTMLParagraphElement>("dev-banner");
const googleButton = requireElement<HTMLButtonElement>("google");
const googleMessage = requireElement<HTMLParagraphElement>("google-message");
const deleteButton = requireElement<HTMLButtonElement>("delete-calendar");
const deleteMessage = requireElement<HTMLParagraphElement>("delete-message");
const calendarCandidates = requireElement<HTMLDivElement>("calendar-candidates");
let savedCalendarId: string | null = null;
let selectedFoundId = "";
let foundCalendars: FoundCalendar[] = [];

interface FoundCalendar {
  id: string;
  summary: string;
  hasAppEvents: boolean;
}
googleButton.disabled = !hasChromeExtensionApis() || !OAUTH_CLIENT_CONFIGURED;
paintDeleteButton();
googleButton.addEventListener("click", () => {
  if (googleButton.disabled) return;
  setText(googleMessage, "Открываю окно Google…");
  googleButton.disabled = true;
  signInFromUserGesture((ok) => {
    if (!ok) {
      googleButton.disabled = !hasChromeExtensionApis() || !OAUTH_CLIENT_CONFIGURED;
      setText(googleMessage, "Google не выдал доступ. Проверьте Test users и нажмите кнопку ещё раз.");
      return;
    }
    void connectGoogle();
  });
});

if (!hasChromeExtensionApis()) {
  devBanner.hidden = false;
  setText(devBanner, "Проверка настроек вне расширения. Значения сохраняются в localStorage этой страницы.");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (hasChromeExtensionApis() && selectedColor()) {
    setText(settingsMessage, calendarListReady ? "Отправляю цвет в Google…" : "Google запросит разрешение на цвет календаря…");
    settingsMessage.className = "hint";
    const requestToken = calendarListReady ? ensureAuthTokenFromGesture : signInFromUserGesture;
    requestToken(() => {
      void save();
    });
    return;
  }
  void save();
});

requireElement<HTMLButtonElement>("clear").addEventListener("click", () => {
  void clearLocal();
});

deleteButton.addEventListener("click", () => {
  if (deleteButton.disabled) return;
  if (savedCalendarId) {
    const approved = window.confirm("Удалить календарь «Расписание вуза» и все пары в нём? Вернуть их будет нельзя.");
    if (!approved) return;
    deleteButton.disabled = true;
    setText(deleteMessage, "Удаляю календарь…");
    ensureAuthTokenFromGesture(() => {
      void removeCalendar();
    });
    return;
  }
  const chosen = foundCalendars.find((item) => item.id === selectedFoundId);
  if (chosen) {
    const note = chosen.hasAppEvents ? "" : " Пар этого расширения в нём не найдено.";
    const approved = window.confirm(`Удалить календарь «${chosen.summary}» и все пары в нём?${note} Вернуть их будет нельзя.`);
    if (!approved) return;
    deleteButton.disabled = true;
    setText(deleteMessage, "Удаляю календарь…");
    ensureAuthTokenFromGesture(() => {
      void removeFoundCalendar(chosen.id);
    });
    return;
  }
  deleteButton.disabled = true;
  setText(deleteMessage, "Ищу календарь расширения…");
  ensureAuthTokenFromGesture((ok) => {
    if (!ok) {
      paintDeleteButton();
      setText(deleteMessage, "Google не выдал доступ. Проверьте Test users и нажмите кнопку ещё раз.");
      return;
    }
    void findCalendars();
  });
});

void load();
watchUpdate();

async function load(): Promise<void> {
  const state = await store.load();
  timezone.value = state.settings.timeZone;
  profile.value = state.settings.profileLabel;
  group.value = state.settings.groupName;
  origin.value = state.settings.sourceOrigin;
  path.value = state.settings.sourcePathPrefix;
  openCalendar.checked = state.settings.openCalendarAfterWrite;
  theme = state.settings.theme;
  themeLight.checked = theme === "light";
  themeDark.checked = theme === "dark";
  themeYellow.checked = theme === "yellow";
  applyTheme(theme, true);
  calendarListReady = state.calendarListReady;
  savedCalendarId = state.googleCalendarId;
  selectedFoundId = "";
  foundCalendars = [];
  clear(calendarCandidates);
  calendarCandidates.hidden = true;
  paintDeleteButton();
  paintColors(state.settings.calendarColorId);
}

async function save(): Promise<void> {
  const parsed = validateSettings({
    timeZone: timezone.value,
    profileLabel: profile.value,
    groupName: group.value,
    sourceOrigin: origin.value,
    sourcePathPrefix: path.value,
    openCalendarAfterWrite: openCalendar.checked,
    calendarColorId: selectedColor(),
    theme,
  });
  if (!parsed.ok) {
    setText(settingsMessage, parsed.issues.map((issue) => issue.message).join(" "));
    settingsMessage.className = "error";
    return;
  }
  if (hasChromeExtensionApis()) {
    const response = await chrome.runtime.sendMessage({ type: "saveSettings", settings: parsed.value });
    if (response && typeof response === "object" && "ok" in response && response.ok === true) {
      const message = "message" in response && typeof response.message === "string" ? response.message : "Настройки сохранены.";
      if (message.includes("Цвет календаря обновлён")) calendarListReady = true;
      applyTheme(parsed.value.theme, true);
      setText(settingsMessage, message);
      settingsMessage.className = "hint";
      return;
    }
  }
  const state = await store.load();
  await store.save({ ...state, settings: parsed.value });
  applyTheme(parsed.value.theme, true);
  setText(settingsMessage, "Настройки сохранены.");
  settingsMessage.className = "hint";
}

async function connectGoogle(): Promise<void> {
  if (!hasChromeExtensionApis()) return;
  const response = await chrome.runtime.sendMessage({ type: "connectGoogle" });
  googleButton.disabled = !OAUTH_CLIENT_CONFIGURED;
  const message = response && typeof response === "object" && "message" in response && typeof response.message === "string"
    ? response.message
    : "Google не подключён.";
  setText(googleMessage, message);
}

function paintColors(selected: string): void {
  calendarColorId = selected;
  clear(calendarColors);
  calendarColors.append(colorChoice("", "Не задавать", "", selected));
  for (const color of CALENDAR_COLORS) {
    calendarColors.append(colorChoice(color.id, color.name, color.background, selected));
  }
}

function colorChoice(id: string, name: string, background: string, selected: string): HTMLLabelElement {
  const label = el("label", "", "swatch");
  const input = el("input");
  input.type = "radio";
  input.name = "calendar-color";
  input.value = id;
  input.checked = id === selected;
  input.addEventListener("change", () => {
    if (input.checked) calendarColorId = id;
  });
  label.append(input);
  if (background) {
    const dot = el("span", "", "dot");
    dot.style.background = background;
    label.append(dot);
  }
  label.append(el("span", name));
  return label;
}

function selectedColor(): string {
  return calendarColorId;
}

function bindTheme(input: HTMLInputElement, value: ThemeId): void {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    theme = value;
    applyTheme(value);
  });
}

async function removeCalendar(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "deleteCalendar" });
  finishDelete(response);
}

async function removeFoundCalendar(calendarId: string): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "deleteCalendar", calendarId });
  finishDelete(response);
}

function finishDelete(response: unknown): void {
  const message = response && typeof response === "object" && "message" in response && typeof response.message === "string"
    ? response.message
    : "Календарь не удалён.";
  const ok = Boolean(response && typeof response === "object" && "ok" in response && response.ok === true);
  if (ok) {
    savedCalendarId = null;
    selectedFoundId = "";
    foundCalendars = [];
    clear(calendarCandidates);
    calendarCandidates.hidden = true;
  }
  paintDeleteButton();
  setText(deleteMessage, message);
}

async function findCalendars(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "findAppCalendars" });
  const message = response && typeof response === "object" && "message" in response && typeof response.message === "string"
    ? response.message
    : "Календарь расширения не найден.";
  foundCalendars = readFoundCalendars(response);
  selectedFoundId = "";
  paintCandidates();
  paintDeleteButton();
  setText(deleteMessage, message);
}

function readFoundCalendars(response: unknown): FoundCalendar[] {
  if (!response || typeof response !== "object" || !("ok" in response) || response.ok !== true) return [];
  if (!("calendars" in response) || !Array.isArray(response.calendars)) return [];
  const calendars: FoundCalendar[] = [];
  for (const item of response.calendars) {
    if (!item || typeof item !== "object") continue;
    const source = item as { id?: unknown; summary?: unknown; hasAppEvents?: unknown };
    if (typeof source.id !== "string" || source.id.includes("://") || typeof source.summary !== "string" || typeof source.hasAppEvents !== "boolean") continue;
    calendars.push({ id: source.id, summary: source.summary, hasAppEvents: source.hasAppEvents });
  }
  return calendars;
}

function paintCandidates(): void {
  clear(calendarCandidates);
  calendarCandidates.hidden = foundCalendars.length === 0;
  for (const calendar of foundCalendars) {
    const label = el("label", "", "candidate");
    const input = el("input");
    input.type = "radio";
    input.name = "found-calendar";
    input.value = calendar.id;
    input.addEventListener("change", () => {
      if (input.checked) {
        selectedFoundId = calendar.id;
        paintDeleteButton();
      }
    });
    const note = calendar.hasAppEvents ? "" : " — пар этого расширения не найдено";
    label.append(input, el("span", `${calendar.summary}${note}`));
    calendarCandidates.append(label);
  }
}

function paintDeleteButton(): void {
  const canUseGoogle = hasChromeExtensionApis() && OAUTH_CLIENT_CONFIGURED;
  if (!canUseGoogle) {
    deleteButton.disabled = true;
    deleteButton.textContent = "Удалить календарь";
    return;
  }
  deleteButton.disabled = false;
  if (savedCalendarId) {
    deleteButton.textContent = "Удалить календарь";
    return;
  }
  deleteButton.textContent = selectedFoundId ? "Удалить выбранный календарь" : "Найти календарь расширения";
}

async function clearLocal(): Promise<void> {
  const approved = window.confirm("Удалить локальные настройки и снимок? Номер календаря сохранится, сам календарь Google не изменится.");
  if (!approved) return;
  if (hasChromeExtensionApis()) {
    await chrome.runtime.sendMessage({ type: "clearLocalData" });
  } else {
    const state = await store.load();
    const cleared = defaultAppState();
    cleared.googleCalendarId = state.googleCalendarId;
    await store.save(cleared);
  }
  await load();
  setText(clearMessage, "Локальные данные очищены. Разрешение Google, если оно появится позже, нужно отзывать в аккаунте Google отдельно.");
  setText(settingsMessage, "");
}
