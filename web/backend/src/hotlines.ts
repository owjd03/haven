import hotlinesData from "../data/hotlines.json";
import type { CountryHotlines, HotlineData } from "./types";

/** Bundled fallback, scraped at build time by tools/hotlines/build_hotlines.py. May be out of date. */
export const LOCAL_HOTLINES: HotlineData = hotlinesData as HotlineData;

/** True when a field is empty or still a "TODO: verify" placeholder. */
export function isPlaceholder(value: string | undefined): boolean {
  return !value || /todo/i.test(value);
}

/** Links must be ordinary web addresses (or an unfinished placeholder), never `javascript:` or `data:`. */
function isSafeLink(url: unknown): boolean {
  if (url === undefined || url === null || url === "") return true;
  return typeof url === "string" && (isPlaceholder(url) || /^https?:\/\//i.test(url));
}

/** Validates data (e.g. from Remote Config) and falls back to the bundled list if malformed. */
export function parseHotlines(raw: unknown): HotlineData | null {
  try {
    const d = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<HotlineData>;
    if (!d || !Array.isArray(d.countries) || d.countries.length === 0) return null;
    const ok = d.countries.every(
      (c) =>
        c &&
        typeof c.code === "string" &&
        typeof c.name === "string" &&
        Array.isArray(c.lines) &&
        c.lines.every((l) => l && isSafeLink(l.url)),
    );
    return ok && isSafeLink(d.directoryUrl) ? (d as HotlineData) : null;
  } catch {
    return null;
  }
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matches free text a user typed ("uk", "I'm in Toronto, Canada", "Texas") to a country in the list.
 * Pure string matching: no model, nothing leaves the device. Returns undefined when nothing matches.
 * Names of two letters or fewer ("us", "uk") and ISO codes only match when typed on their own, so
 * ordinary words like "in" or "it" inside a sentence never pick a country.
 */
export function matchCountry(input: string, data: HotlineData): CountryHotlines | undefined {
  const whole = norm(input);
  if (!whole) return undefined;
  const q = " " + whole + " ";
  let best: { c: CountryHotlines; len: number } | undefined;
  for (const c of data.countries) {
    if (c.code === "OTHER") continue;
    if (whole === norm(c.code)) return c;
    const names = new Set([c.name, ...(c.aliases ?? [])].map(norm).filter(Boolean));
    for (const n of names) {
      const hit = n.length <= 2 ? whole === n : q.includes(" " + n + " ");
      if (hit && (!best || n.length > best.len)) best = { c, len: n.length };
    }
  }
  return best?.c;
}

/**
 * The number to dial for a display string, or undefined if the string doesn't clearly start with one.
 * "988" -> "988", "England: 116 123" -> "116123", "0800 58 58 58 (5pm - midnight)" -> "0800585858",
 * "Police 110, Ambulance 119" -> undefined (not safe to turn into a single link).
 */
export function telNumber(display: string): string | undefined {
  const s = display.replace(/^[^\d+(]{1,40}:\s*/, "").trim();
  const m = /^(\+?\d[\d\s.-]*(?:\(\d[\d\s.-]*\)[\d\s.-]*)*)/.exec(s);
  if (!m) return undefined;
  const digits = m[1].replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 15
    ? (m[1].trim().startsWith("+") ? "+" : "") + digits
    : undefined;
}
