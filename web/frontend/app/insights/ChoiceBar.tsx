"use client";

import { INSIGHT_RANGES } from "@/lib/insights";

const CHIP =
  "inline-flex min-h-[44px] cursor-pointer items-center rounded-lg border border-line bg-surface px-4 py-2 transition-colors duration-150 peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:font-medium peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-accent peer-disabled:cursor-default";

type Source = "journal" | "chats" | "aboutMe";
const SOURCES: Array<{ key: Source; label: string }> = [
  { key: "journal", label: "Journal notes" },
  { key: "chats", label: "Chats" },
  { key: "aboutMe", label: "About me" },
];

/** The choices this bar edits. `aboutMe` is only offered by pages that include About me notes. */
export interface Choices {
  days: 7 | 30;
  journal: boolean;
  chats: boolean;
  aboutMe?: boolean;
}

/** How far back, and what to look at, in one compact row. At least one source always stays on. */
export default function ChoiceBar<T extends Choices>({
  choices,
  onChange,
}: {
  choices: T;
  onChange: (next: T) => void;
}) {
  // A page that has no `aboutMe` choice doesn't get that chip.
  const offered = SOURCES.filter((s) => s.key !== "aboutMe" || choices.aboutMe !== undefined);
  const onCount = offered.filter((s) => choices[s.key]).length;
  return (
    <div className="mt-5 flex flex-wrap items-start justify-center gap-x-8 gap-y-4">
      <fieldset>
        <legend className="mx-auto text-sm font-medium text-muted">How far back</legend>
        <div className="mt-1.5 flex flex-wrap justify-center gap-2">
          {INSIGHT_RANGES.map((r) => (
            <label key={r.days} className="relative">
              <input
                type="radio"
                name="insight-range"
                value={r.days}
                checked={choices.days === r.days}
                onChange={() => onChange({ ...choices, days: r.days })}
                className="peer sr-only"
              />
              <span className={CHIP}>{r.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mx-auto text-sm font-medium text-muted">Look at (at least one)</legend>
        <div className="mt-1.5 flex flex-wrap justify-center gap-2">
          {offered.map((s) => {
            const on = Boolean(choices[s.key]);
            return (
              <label key={s.key} className="relative">
                <input
                  type="checkbox"
                  checked={on}
                  // At least one source must stay on.
                  disabled={on && onCount === 1}
                  onChange={() => onChange({ ...choices, [s.key]: !on })}
                  className="peer sr-only"
                />
                <span className={CHIP}>{s.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
