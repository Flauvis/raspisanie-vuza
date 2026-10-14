import { isCalendarColorId } from "../calendar/colors";
import { isValidTimeZone } from "./time";
import type { AppSettings, ThemeId } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  timeZone: "",
  profileLabel: "",
  groupName: "",
  sourceOrigin: "",
  sourcePathPrefix: "",
  openCalendarAfterWrite: false,
  calendarColorId: "",
  theme: "light",
};

export interface SettingsIssue {
  field: keyof AppSettings;
  message: string;
}

export function validateSettings(input: unknown): { ok: true; value: AppSettings } | { ok: false; issues: SettingsIssue[] } {
  if (!input || typeof input !== "object") {
    return { ok: false, issues: [{ field: "timeZone", message: "Настройки переданы в неверном формате." }] };
  }
  const source = input as Record<string, unknown>;
  const timeZone = readText(source.timeZone, 80);
  const profileLabel = readText(source.profileLabel, 80);
  const groupName = source.groupName === undefined ? "" : readText(source.groupName, 80);
  const sourceOrigin = readText(source.sourceOrigin, 200);
  const sourcePathPrefix = readText(source.sourcePathPrefix, 200);
  const openCalendarAfterWrite = readFlag(source.openCalendarAfterWrite);
  const calendarColorId = readColor(source.calendarColorId);
  const theme = readTheme(source.theme);
  const issues: SettingsIssue[] = [];

  if (timeZone && !isValidTimeZone(timeZone)) {
    issues.push({ field: "timeZone", message: "Укажите часовой пояс вуза в формате IANA, например Europe/Moscow." });
  }
  if (sourceOrigin && !isHttpsOrigin(sourceOrigin)) {
    issues.push({
      field: "sourceOrigin",
      message: "Адрес сайта должен быть https-origin без пути, логина и параметров.",
    });
  }
  if (sourcePathPrefix && !isSafePathPrefix(sourcePathPrefix)) {
    issues.push({
      field: "sourcePathPrefix",
      message: "Префикс пути должен начинаться с / и не содержать .., запрос или фрагмент.",
    });
  }
  if (
    issues.length > 0 ||
    timeZone === null ||
    profileLabel === null ||
    groupName === null ||
    sourceOrigin === null ||
    sourcePathPrefix === null ||
    openCalendarAfterWrite === null ||
    calendarColorId === null ||
    theme === null
  ) {
    if (timeZone === null) issues.push({ field: "timeZone", message: "Часовой пояс слишком длинный или не является текстом." });
    if (profileLabel === null) issues.push({ field: "profileLabel", message: "Название профиля слишком длинное или не является текстом." });
    if (groupName === null) issues.push({ field: "groupName", message: "Название группы слишком длинное или не является текстом." });
    if (sourceOrigin === null) issues.push({ field: "sourceOrigin", message: "Адрес сайта слишком длинный или не является текстом." });
    if (sourcePathPrefix === null) {
      issues.push({ field: "sourcePathPrefix", message: "Префикс пути слишком длинный или не является текстом." });
    }
    if (openCalendarAfterWrite === null) {
      issues.push({ field: "openCalendarAfterWrite", message: "Отметка открытия календаря должна быть включена или выключена." });
    }
    if (calendarColorId === null) {
      issues.push({ field: "calendarColorId", message: "Выберите цвет из списка календаря Google." });
    }
    if (theme === null) {
      issues.push({ field: "theme", message: "Выберите светлую, тёмную или тёмную рваную тему." });
    }
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: { timeZone, profileLabel, groupName, sourceOrigin, sourcePathPrefix, openCalendarAfterWrite, calendarColorId, theme },
  };
}

export function pathAllowed(pathname: string, prefix: string): boolean {
  if (!prefix || prefix === "/") return true;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function readTheme(value: unknown): ThemeId | null {
  if (value === undefined || value === "") return "light";
  if (value === "light" || value === "dark" || value === "yellow") return value;
  return null;
}

function readColor(value: unknown): string | null {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || !isCalendarColorId(value)) return null;
  return value;
}

function readFlag(value: unknown): boolean | null {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  return null;
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function isSafePathPrefix(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return false;
  if (value.includes("?") || value.includes("#") || value.includes("..")) return false;
  return true;
}
