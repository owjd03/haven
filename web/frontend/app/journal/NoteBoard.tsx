"use client";

import { cx } from "@/components/ui";
import { formatDay, noteColorFor, tiltFor } from "@/lib/journal";
import type { JournalEntry } from "@/lib/types";
import type { CSSProperties, MouseEvent } from "react";
import { PAPER } from "./NoteDialog";

interface Props {
  entries: JournalEntry[];
  /** The note that was just added, so it can fade in. */
  freshId: number | null;
  onOpen: (e: JournalEntry) => void;
  onCreate: () => void;
}

function groupByDay(entries: JournalEntry[]): [string, JournalEntry[]][] {
  const map = new Map<string, JournalEntry[]>();
  for (const e of entries) map.set(e.day, [...(map.get(e.day) ?? []), e]);
  return [...map.entries()];
}

export default function NoteBoard({ entries, freshId, onOpen, onCreate }: Props) {
  // Clicking empty board space starts a note. Clicks on a note open that note instead.
  // This is a bonus for mouse and touch; the New note button is the path for everyone.
  function onBoardClick(e: MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    onCreate();
  }

  return (
    <div
      role="presentation"
      onClick={onBoardClick}
      className="mt-3 min-h-[60vh] cursor-copy rounded-xl bg-surface p-4 sm:p-6"
    >
      {entries.length === 0 ? (
        <p className="pt-16 text-center text-lg text-muted">
          Nothing here yet. Click anywhere on the board to add your first note.
        </p>
      ) : (
        <>
          {groupByDay(entries).map(([day, list]) => (
            <section key={day} aria-labelledby={`day-${day}`} className="mb-6">
              <h3 id={`day-${day}`} className="text-lg">
                {formatDay(day)}
              </h3>
              <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(e)}
                      style={{ "--tilt": `${tiltFor(e.id)}deg` } as CSSProperties}
                      className={cx(
                        "note-paper block w-full cursor-pointer rounded-lg p-4 text-left text-ink shadow-sm transition-[rotate,box-shadow] duration-150 ease-out hover:rotate-0 hover:shadow-md focus-visible:rotate-0",
                        "rotate-(--tilt)",
                        PAPER[noteColorFor(e)],
                        e.id === freshId && "note-fresh",
                      )}
                    >
                      <span className="sr-only">{formatDay(e.day)}. </span>
                      <span className="block font-medium">Mood {e.mood} of 10</span>
                      <span className="mt-1 line-clamp-5 block break-words whitespace-pre-wrap">
                        {e.text}
                      </span>
                      {e.crisisFlag && (
                        <span className="mt-2 block text-sm text-muted">Kept private</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="pt-2 text-center text-sm text-muted">
            Tip: click an empty spot on the board to add a note.
          </p>
        </>
      )}
    </div>
  );
}
