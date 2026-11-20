"use client";

/**
 * Appearance settings, stored on this device only. Light, Small text and the default font are the
 * defaults, and the defaults are stored as "nothing saved". Haven does not follow the system
 * dark-mode setting.
 */
export type Theme = "light" | "dark";
export type TextSize = "small" | "normal" | "large";
export type FontChoice = "default" | "system" | "nunito" | "atkinson" | "serif";
export const FONT_CHOICES: readonly FontChoice[] = ["default", "system", "nunito", "atkinson", "serif"];

const THEME_KEY = "haven.theme";
const TEXT_KEY = "haven.textSize";
const FONT_KEY = "haven.font";

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
  return v === "large" || v === "normal" ? v : "small";
};
export const getFont = (): FontChoice => {
  const v = read(FONT_KEY);
  return FONT_CHOICES.find((f) => f === v && f !== "default") ?? "default";
};

/** Sync the page with what is saved (also used after restoring a backup or deleting data). */
export function applyAppearance(
  theme: Theme = getTheme(),
  size: TextSize = getTextSize(),
  font: FontChoice = getFont(),
): void {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  root.setAttribute("data-text", size);
  if (font === "default") root.removeAttribute("data-font");
  else root.setAttribute("data-font", font);
}

export function setTheme(theme: Theme): void {
  write(THEME_KEY, theme === "dark" ? "dark" : null);
  applyAppearance(theme, getTextSize(), getFont());
}

export function setTextSize(size: TextSize): void {
  write(TEXT_KEY, size === "large" || size === "normal" ? size : null);
  applyAppearance(getTheme(), size, getFont());
}

export function setFont(font: FontChoice): void {
  write(FONT_KEY, font === "default" ? null : font);
  applyAppearance(getTheme(), getTextSize(), font);
}
