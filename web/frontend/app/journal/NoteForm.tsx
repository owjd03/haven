"use client";

import { Button, Textarea, cx } from "@/components/ui";
import { useCrisis } from "@/components/CrisisProvider";
import { addJournalEntry, updateJournalEntry } from "@/lib/db";
import { formatDay, isCrisisText, localDayKey, noteColorFor, validateEntry } from "@/lib/journal";
import type { JournalEntry } from "@/lib/types";
import { NOTE_COLORS, type NoteColor } from "@haven/backend";
import { useEffect, useState, type FormEvent } from "react";

const MOODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Plain names, so colour is never the only way to tell the choices apart. */
const COLOR_NAMES: Record<NoteColor, string> = {
  butter: "Butter yellow",
  peach: "Peach",
  sage: "Sage green",
  sky: "Sky blue",
  lilac: "Lilac",
};
const SWATCH: Record<NoteColor, string> = {
  butter: "bg-note-butter",
  peach: "bg-note-peach",
  sage: "bg-note-sage",
  sky: "bg-note-sky",
  lilac: "bg-note-lilac",
};

interface Props {
  /** When set, the form edits this entry instead of making a new one. */
  initial: JournalEntry | null;
  color: NoteColor;
  onColorChange: (c: NoteColor) => void;
  onSaved: (saved: JournalEntry, message: string) => void;
  /** Close or Cancel pressed: the dialog decides whether to ask "Discard?" first. */
  onCancel: () => void;
  /** "Delete note" pressed on an existing note: the dialog asks to confirm. */
  onRequestDelete: () => void;
  /** "Discard" in the crisis notice: the person already chose, so close without asking again. */
  onDiscard: () => void;
  /** Tells the dialog whether there is unsaved text worth protecting. */
  onDirtyChange: (dirty: boolean) => void;
}

export default function NoteForm({
  initial,
  color,
  onColorChange,
  onSaved,
  onCancel,
  onDiscard,
  onDirtyChange,
  onRequestDelete,
}: Props) {
  const { triggerCrisis } = useCrisis();
  // No day to pick: a new note is for today, and an existing note keeps the day it was written.
  // The day is worked out when you press Save, so a popup left open past midnight still gets it right.
  const [shownDay, setShownDay] = useState(initial?.day ?? "");
  const [mood, setMood] = useState<number | null>(initial?.mood ?? null);
  const [text, setText] = useState(initial?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [crisisPending, setCrisisPending] = useState(false);
  const [saving, setSaving] = useState(false);
  // Mood and colour are tucked away on an existing note. A new note needs a mood, so it starts open.
  const [optionsOpen, setOptionsOpen] = useState(!initial);

  // The date only exists in the browser; set it after mount to avoid a server/client mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShownDay((d) => d || localDayKey());
  }, []);

  // Something worth protecting from a stray close: changed words, or (on an existing note) a changed
  // mood or colour. Picking a mood on a brand-new note alone isn't worth a "Discard?" question.
  const changed =
    text.trim() !== (initial?.text ?? "").trim() ||
    (initial !== null && (mood !== initial.mood || color !== noteColorFor(initial)));
  useEffect(() => {
    onDirtyChange(changed);
  }, [changed, onDirtyChange]);

  async function persist(crisisFlag: boolean) {
    setSaving(true);
    try {
      const now = Date.now();
      const base = {
        day: initial?.day ?? localDayKey(now),
        mood: mood as number,
        text: text.trim(),
        updatedAt: now,
        color,
      };
      const flag = crisisFlag ? { crisisFlag: true as const } : {};
      if (initial) {
        const saved: JournalEntry = { ...initial, ...base, crisisFlag: undefined, ...flag };
        await updateJournalEntry(saved);
        onSaved(saved, "Changes saved on this device.");
      } else {
        const saved = await addJournalEntry({ ...base, createdAt: now, ...flag });
        onSaved(saved, "Saved on this device.");
      }
    } catch {
      setError("Couldn't save that. Your browser may be blocking storage. Please try again.");
      setSaving(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const today = localDayKey();
    const problem = validateEntry({ day: initial?.day ?? today, mood, text }, today);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    // Same safety rule as chat: show support first. The note stays here, unsaved, until the user chooses.
    if (isCrisisText(text)) {
      setCrisisPending(true);
      triggerCrisis();
      return;
    }
    await persist(false);
  }

  const moodRow = (
    <fieldset aria-describedby="mood-help">
      <legend className="font-medium">How are you feeling, out of 10?</legend>
      <p id="mood-help" className="mt-1 text-sm text-muted">
        1 is really low and 10 is really good. It&apos;s your own number, there&apos;s no right
        answer.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {MOODS.map((n) => (
          <label key={n} className="relative">
            <input
              type="radio"
              name="mood"
              value={n}
              checked={mood === n}
              onChange={() => setMood(n)}
              className="peer sr-only"
            />
            <span className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-ink/20 bg-bg/60 transition-colors duration-150 peer-checked:border-ink peer-checked:bg-bg peer-checked:font-semibold peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-accent">
              {n}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  const colourRow = (
    <fieldset>
      <legend className="font-medium">Note colour</legend>
      <p className="mt-1 text-sm text-muted">Just for looks. It doesn&apos;t mean anything.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {NOTE_COLORS.map((c) => (
          <label key={c} className="relative" title={COLOR_NAMES[c]}>
            <input
              type="radio"
              name="note-color"
              value={c}
              checked={color === c}
              onChange={() => onColorChange(c)}
              className="peer sr-only"
            />
            <span
              className={cx(
                "flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border-2 border-ink/25 text-lg transition-colors duration-150 peer-checked:border-ink peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-accent",
                SWATCH[c],
              )}
            >
              <span aria-hidden="true">{color === c ? "✓" : ""}</span>
              <span className="sr-only">{COLOR_NAMES[c]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <form onSubmit={submit} noValidate aria-labelledby="note-dialog-h">
      <h2 id="note-dialog-h" className="text-2xl">
        {initial ? formatDay(initial.day) : "New note"}
      </h2>
      {!initial && shownDay && <p className="mt-1 text-muted">{formatDay(shownDay)}</p>}
      {initial && (
        <p className="mt-1 flex flex-wrap items-center gap-x-3">
          <span className="font-medium">Mood {mood} of 10</span>
          <button
            type="button"
            onClick={() => setOptionsOpen((o) => !o)}
            aria-expanded={optionsOpen}
            className="rounded py-1 text-sm text-muted underline underline-offset-4 hover:text-ink focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-accent"
          >
            {optionsOpen ? "Hide mood and colour" : "Change mood or colour"}
          </button>
        </p>
      )}

      {optionsOpen && (
        <div className="mt-4 space-y-5">
          {moodRow}
          {colourRow}
        </div>
      )}

      <div className="mt-5">
        <label htmlFor="entry-text" className={initial ? "sr-only" : "block font-medium"}>
          {initial ? "Your note" : "What’s on your mind?"}
        </label>
        {/* A clear border, so it's plain that this is where you type. On an existing note you just edit here. */}
        <Textarea
          id="entry-text"
          tone="bg"
          radius="xl"
          data-modal-focus={initial ? undefined : true}
          autoFocus={!initial}
          className="mt-1 min-h-32 w-full border-2! border-ink/30! focus:border-accent!"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {initial?.crisisFlag && (
          <p className="mt-2 text-sm text-muted">
            Kept private. This note is never sent to any AI.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-danger-bg p-4 text-danger-ink">
          {error}
        </p>
      )}

      {crisisPending && (
        <div role="alert" className="mt-4 rounded-xl bg-warn-bg p-4 text-warn-ink">
          <p className="font-medium">What you wrote sounds really painful.</p>
          <p className="mt-1">
            It hasn&apos;t been saved yet. You can keep it just for yourself on this device. It will
            never be sent to any AI, including Insights. Or you can let it go.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" type="button" onClick={() => persist(true)} disabled={saving}>
              Save privately
            </Button>
            <Button size="sm" variant="secondary" type="button" onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {/* On an existing note, Save only appears once something has changed. */}
        {(!initial || changed) && (
          <Button type="submit" disabled={saving || crisisPending}>
            {saving ? "Saving…" : initial ? "Save changes" : "Save note"}
          </Button>
        )}
        <Button variant="secondary" type="button" onClick={onCancel}>
          {initial ? "Close" : "Cancel"}
        </Button>
        {initial && (
          <button
            type="button"
            onClick={onRequestDelete}
            className="ml-auto rounded px-2 py-2 text-sm text-muted underline-offset-4 hover:text-danger-ink hover:underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-accent"
          >
            Delete note
          </button>
        )}
      </div>
      <p className="mt-3 text-sm text-muted">Saved only on this device.</p>
    </form>
  );
}
