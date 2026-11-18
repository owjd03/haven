import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [m[1], m[2]]),
  );
}

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Soft colours must never mean hard to read: every text/background pair keeps WCAG AA (4.5:1).
const TEXT_PAIRS: [string, string][] = [
  ["ink", "bg"],
  ["ink", "surface"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "peach"],
  ["accent-ink", "accent"],
  ["bubble-user-ink", "bubble-user"],
  ["ink", "bubble-bot"],
  ["ink", "accent-soft"],
  ["ink", "peach"],
  ["warn-ink", "warn-bg"],
  ["danger-ink", "danger-bg"],
  // Sticky-note paper: the text on it (and the small mood line) stays readable on every colour.
  ...["butter", "peach", "sage", "sky", "lilac"].flatMap((c): [string, string][] => [
    ["ink", `note-${c}`],
    ["muted", `note-${c}`],
  ]),
];

describe.each([
  ["light", ":root"],
  ["dark", ':root[data-theme="dark"]'],
])("%s palette", (_name, selector) => {
  const t = block(selector);
  it.each(TEXT_PAIRS)("%s on %s has at least 4.5:1 contrast", (fg, bg) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it("accent is distinguishable from the page background (3:1 for UI shapes)", () => {
    expect(ratio(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
  });
});

describe("theme behaviour", () => {
  it("is light by default and does not follow the system dark-mode setting", () => {
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark/);
    expect(css).toMatch(/:root\[data-theme="dark"\]/);
  });
  it("keeps soft colours: no saturated primaries in the palette", () => {
    for (const hex of Object.values(block(":root"))) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      expect(sat, hex).toBeLessThan(0.55);
    }
  });
});
