"use client";

import { useEffect, useState } from "react";
import {
  getFont,
  getTextSize,
  getTheme,
  setFont,
  setTextSize,
  setTheme,
  type FontChoice,
  type TextSize,
  type Theme,
} from "@/lib/appearance";

interface Option<T extends string> {
  value: T;
  label: string;
  /** CSS font-family to show the label in, so each name appears in its own font. */
  font?: string;
}

function Choice<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="mt-5">
      <legend className="font-medium">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="relative">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span
              style={o.font ? { fontFamily: o.font } : undefined}
              className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-line bg-surface px-5 py-2.5 peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:font-medium peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-accent"
            >
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const FONT_OPTIONS: Option<FontChoice>[] = [
  { value: "default", label: "Default", font: "var(--font-geist-sans), system-ui, sans-serif" },
  {
    value: "system",
    label: "System",
    font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  { value: "nunito", label: "Nunito", font: "var(--font-nunito), system-ui, sans-serif" },
  { value: "atkinson", label: "Atkinson", font: "var(--font-atkinson), system-ui, sans-serif" },
  { value: "serif", label: "Serif", font: "var(--font-serif-source), Georgia, serif" },
];

const FONT_NOTES: Record<FontChoice, string> = {
  default: "Clean and plain. This is how Haven starts.",
  system: "The font your device already uses. On a Mac, iPhone or iPad that is San Francisco.",
  nunito: "Soft and rounded.",
  atkinson: "Very clear letters, designed to be easy to tell apart.",
  serif: "A calm, book-like serif.",
};

export default function AppearanceSettings() {
  const [theme, setThemeState] = useState<Theme>("light");
  const [size, setSizeState] = useState<TextSize>("small");
  const [font, setFontState] = useState<FontChoice>("default");

  // localStorage only exists in the browser; read after mount to avoid a hydration mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(getTheme());
    setSizeState(getTextSize());
    setFontState(getFont());
  }, []);

  return (
    <section aria-labelledby="appearance-h" className="mt-6">
      <h2 id="appearance-h" className="text-2xl font-semibold tracking-tight">
        Appearance
      </h2>
      <p className="mt-1 text-muted">
        Haven starts in light mode. It doesn&apos;t follow your computer&apos;s dark-mode setting
        unless you choose Dark here. Your choices are saved on this device only.
      </p>

      <Choice
        name="theme"
        legend="Colour mode"
        value={theme}
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        onChange={(v) => {
          setThemeState(v);
          setTheme(v);
        }}
      />
      <Choice
        name="text-size"
        legend="Text size"
        value={size}
        options={[
          { value: "small", label: "Smaller" },
          { value: "normal", label: "Normal" },
          { value: "large", label: "Larger" },
        ]}
        onChange={(v) => {
          setSizeState(v);
          setTextSize(v);
        }}
      />
      <Choice
        name="font"
        legend="Font"
        value={font}
        options={FONT_OPTIONS}
        onChange={(v) => {
          setFontState(v);
          setFont(v);
        }}
      />
      <p className="mt-2 text-sm text-muted">{FONT_NOTES[font]}</p>
    </section>
  );
}
