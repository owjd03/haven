"use client";

import { cx } from "@/components/ui";
import { meterInfo, type GatheredInsights } from "@/lib/insights";

/** A small bar for how full the request is. The numbers are text too, so colour is never the only signal. */
export default function WordMeter({
  g,
}: {
  g: Pick<GatheredInsights, "selectedWords" | "wontFit" | "excluded">;
}) {
  const m = meterInfo(g);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{m.label}</span>
        {m.over && <span className="font-medium text-warn-ink">some won&apos;t fit</span>}
      </div>
      <div
        role="meter"
        aria-label="Words selected"
        aria-valuemin={0}
        aria-valuemax={900}
        aria-valuenow={Math.min(g.selectedWords, 900)}
        aria-valuetext={m.label}
        className="mt-1.5 h-2.5 overflow-hidden rounded-full border border-line bg-bg"
      >
        <div
          className={cx("h-full rounded-full", m.over ? "bg-warn-ink" : "bg-accent")}
          style={{ width: `${m.percent}%` }}
        />
      </div>
      {m.notes.map((n) => (
        <p key={n} className="mt-2 text-sm text-muted">
          {n}
        </p>
      ))}
    </div>
  );
}
