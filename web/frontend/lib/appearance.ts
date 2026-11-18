"use client";

/**
 * Appearance settings, stored on this device only. Light and normal text are the defaults, and the
 * defaults are stored as "nothing saved". Haven does not follow the system dark-mode setting.
 */
export type Theme = "light" | "dark";
export type TextSize = "small" | "normal" | "large";

const THEME_KEY = "haven.theme";
const TEXT_KEY = "haven.textSize";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage may be blocked; the setting still applies for this visit */
  }
}

export const getTheme = (): Theme => (read(THEME_KEY) === "dark" ? "dark" : "light");
export const getTextSize = (): TextSize => {
  const v = read(TEXT_KEY);
  return v === "large" || v === "small" ? v : "normal";
};

/** Sync the page with what is saved (also used after restoring a backup or deleting data). */
export function applyAppearance(theme: Theme = getTheme(), size: TextSize = getTextSize()): void {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  if (size === "large" || size === "small") root.setAttribute("data-text", size);
  else root.removeAttribute("data-text");
}

export function setTheme(theme: Theme): void {
  write(THEME_KEY, theme === "dark" ? "dark" : null);
  applyAppearance(theme, getTextSize());
}

export function setTextSize(size: TextSize): void {
  write(TEXT_KEY, size === "large" || size === "small" ? size : null);
  applyAppearance(getTheme(), size);
}
