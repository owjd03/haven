"use client";

import { cx } from "@/components/ui";
import { formatDay } from "@/lib/journal";
import { orderForDisplay, type InsightItem } from "@/lib/insights";

interface Props {
  title: string;
  items: InsightItem[];
  /** Ids that are selected (will be sent). Everything starts selected. */
  selected: ReadonlySet<string>;
  /** Selected items that don't fit, because the word budget is full. */
  wontFit: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Opens the full text of one item. */
  onRead: (item: InsightItem) => void;
  /** Shown on one slim line, instead of an empty box, when the list has nothing in it. */
  emptyText: string;
  className?: string;
}

/** A quiet text-style control: small, muted, no box. Calm on purpose. */
const QUIET =
  "cursor-pointer rounded px-1.5 py-1 text-sm text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-accent disabled:cursor-default disabled:no-underline disabled:opacity-60";

/**
 * A soft check circle: empty when the note is not selected, a pale circle with a thin check when it is.
 * The check mark (not only the colour) shows the state. The button is 44px square to tap, drawn small.
 */
function CheckCircle({
  selected,
  label,
  onToggle,
}: {
  selected: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={onToggle}
      className="absolute top-0 right-0 inline-flex size-11 cursor-pointer items-center justify-center rounded-full focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-accent"
    >
      <span
        aria-hidden
        className={cx(
          "inline-flex size-6 items-center justify-center rounded-full border transition-colors duration-150",
          selected
            ? "border-accent/50 bg-accent-soft text-accent"
            : "border-ink/30 text-transparent",
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}

/**
 * One note. The card opens the full text; the check circle in its corner chooses whether it is sent.
 * All cards look the same: plain and neutral, no colours, so the page stays calm.
 */
function ItemRow({
  item,
  selected,
  wontFit,
  onToggle,
  onRead,
}: {
  item: InsightItem;
  selected: boolean;
  wontFit: boolean;
  onToggle: (on: boolean) => void;
  onRead: () => void;
}) {
  if (item.locked) {
    return (
      <li className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">
        Journal note · Kept private: never sent to any AI.
      </li>
    );
  }
  const label =
    item.kind === "journal" ? `Mood ${item.mood}/10` : item.kind === "summary" ? "Summary" : null;
  const meta = [label, selected && wontFit && "Won't fit"].filter(Boolean);
  return (
    <li
      className={cx(
        "relative rounded-lg border bg-bg",
        selected ? "border-line" : "border-dashed border-line",
      )}
    >
      <button
        type="button"
        id={`read-${item.id}`}
        onClick={onRead}
        aria-haspopup="dialog"
        title="Open the full text"
        className="block w-full cursor-pointer rounded-lg px-4 py-3 pr-14 text-left focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-accent"
      >
        {meta.length > 0 && <span className="block text-xs text-muted">{meta.join(" · ")}</span>}
        <span className={cx("line-clamp-3 block text-sm break-words", !selected && "text-muted")}>
          {item.preview}
        </span>
      </button>
      <CheckCircle
        selected={selected}
        label={`Send this note: ${item.preview}`}
        onToggle={() => onToggle(!selected)}
      />
    </li>
  );
}

/** One list of notes, grouped by day, with quiet "select all / select none" links. */
export default function ItemList({
  title,
  items,
  selected,
  wontFit,
  onChange,
  onRead,
  emptyText,
  className,
}: Props) {
  const selectable = items.filter((i) => !i.locked);
  const count = selectable.filter((i) => selected.has(i.id)).length;
  // Newest day first, a summary leading its day.
  const ordered = orderForDisplay(items);
  const days = [...new Set(ordered.map((i) => i.day))];

  function set(ids: string[], on: boolean) {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  }
  const allIds = selectable.map((i) => i.id);

  if (items.length === 0) {
    return (
      <section
        aria-label={title}
        className={cx("rounded-xl border border-line bg-surface px-4 py-3 text-sm", className)}
      >
        <span className="font-medium">{title}</span>
        <span className="text-muted"> · {emptyText}</span>
      </section>
    );
  }

  return (
    <section
      aria-label={title}
      className={cx("rounded-xl border border-line bg-surface", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">{title}</h2>
          <p className="text-sm text-muted" role="status">
            {count} of {selectable.length} selected
          </p>
        </div>
        <div className="flex items-center text-sm text-muted">
          <button
            type="button"
            className={QUIET}
            disabled={count === selectable.length}
            onClick={() => set(allIds, true)}
          >
            Select all
          </button>
          <span aria-hidden>·</span>
          <button
            type="button"
            className={QUIET}
            disabled={count === 0}
            onClick={() => set(allIds, false)}
          >
            Select none
          </button>
        </div>
      </div>

      <div
        className="max-h-96 overflow-y-auto px-4 py-3 md:max-h-[calc(100dvh-19rem)] xl:min-h-0 xl:flex-1"
        tabIndex={0}
        aria-label={`${title} list`}
      >
        {days.map((day) => (
          <div key={day} className="pb-4 last:pb-0">
            <p className="mb-2 text-sm text-muted">{formatDay(day)}</p>
            <ul className="space-y-2">
              {ordered
                .filter((i) => i.day === day)
                .map((i) => (
                  <ItemRow
                    key={i.id}
                    item={i}
                    selected={selected.has(i.id)}
                    wontFit={wontFit.has(i.id)}
                    onToggle={(on) => set([i.id], on)}
                    onRead={() => onRead(i)}
                  />
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
