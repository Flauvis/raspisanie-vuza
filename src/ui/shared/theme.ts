import type { ThemeId } from "../../domain/types";

export const THEME_BOOT_KEY = "ucs.theme.v1";

export function themeId(value: string): ThemeId {
  if (value === "dark" || value === "yellow") return value;
  return "light";
}

export function readBootTheme(): ThemeId {
  try {
    return themeId(localStorage.getItem(THEME_BOOT_KEY) ?? "");
  } catch {
    return "light";
  }
}

export function applyTheme(value: string, remember = false): ThemeId {
  const theme = themeId(value);
  document.documentElement.dataset.theme = theme;
  if (remember) {
    try {
      localStorage.setItem(THEME_BOOT_KEY, theme);
    } catch {
      /* Страница может запретить запись. Тема всё равно остаётся на экране. */
    }
  }
  return theme;
}
