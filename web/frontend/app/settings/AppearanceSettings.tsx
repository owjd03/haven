"use client";

import { useEffect, useState } from "react";
import {
  getTextSize,
  getTheme,
  setTextSize,
  setTheme,
  type TextSize,
  type Theme,
} from "@/lib/appearance";

interface Option<T extends string> {
  value: T;
  label: string;
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
            <span className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-line bg-surface px-5 py-2.5 peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:font-medium peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-accent">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function AppearanceSettings() {
  const [theme, setThemeState] = useState<Theme>("light");
  const [size, setSizeState] = useState<TextSize>("normal");

  // localStorage only exists in the browser; read after mount to avoid a hydration mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(getTheme());
    setSizeState(getTextSize());
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
    </section>
  );
}
