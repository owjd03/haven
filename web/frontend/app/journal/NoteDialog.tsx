"use client";

import { cx } from "@/components/ui";
import ConfirmDialog from "@/components/ConfirmDialog";
import Modal from "@/components/Modal";
import { noteColorFor } from "@/lib/journal";
import type { JournalEntry } from "@/lib/types";
import type { NoteColor } from "@haven/backend";
import { useState } from "react";
import NoteForm from "./NoteForm";

export const PAPER: Record<NoteColor, string> = {
  butter: "bg-note-butter",
  peach: "bg-note-peach",
  sage: "bg-note-sage",
  sky: "bg-note-sky",
  lilac: "bg-note-lilac",
};

/** "new" is an empty note; "view" opens an existing one, which can be edited right there. */
export type DialogState = { mode: "new" } | { mode: "view"; entry: JournalEntry };

interface Props {
  state: DialogState;
  defaultColor: NoteColor;
  onClose: () => void;
  onSaved: (saved: JournalEntry, message: string) => void;
  onDelete: (entry: JournalEntry) => Promise<void>;
  fallbackFocus: () => HTMLElement | null;
}

/** One card for the whole life of a note: write it, read it, change it in place, delete it. */
export default function NoteDialog({
  state,
  defaultColor,
  onClose,
  onSaved,
  onDelete,
  fallbackFocus,
}: Props) {
  const entry = state.mode === "new" ? null : state.entry;
  // The paper recolours live as you pick a colour.
  const [color, setColor] = useState<NoteColor>(entry ? noteColorFor(entry) : defaultColor);
  const [dirty, setDirty] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [askDelete, setAskDelete] = useState(false);

  function requestClose() {
    if (dirty) setAskDiscard(true);
    else onClose();
  }

  return (
    <>
      <Modal
        labelledBy="note-dialog-h"
        onRequestClose={requestClose}
        // A stray click outside must never throw away typed words.
        dismissOnOutside={!dirty}
        suspended={askDiscard || askDelete}
        fallbackFocus={fallbackFocus}
        className={cx("text-ink", PAPER[color])}
      >
        <NoteForm
          initial={entry}
          color={color}
          onColorChange={setColor}
          onSaved={onSaved}
          onCancel={requestClose}
          onDiscard={onClose}
          onDirtyChange={setDirty}
          onRequestDelete={() => setAskDelete(true)}
        />
      </Modal>

      {askDiscard && (
        <ConfirmDialog
          title={entry ? "Discard your changes?" : "Discard this note?"}
          confirmLabel="Discard"
          cancelLabel="Keep writing"
          danger
          onConfirm={() => {
            setAskDiscard(false);
            onClose();
          }}
          onCancel={() => setAskDiscard(false)}
        >
          <p>What you wrote here hasn&apos;t been saved, and it will be lost.</p>
        </ConfirmDialog>
      )}
      {askDelete && entry && (
        <ConfirmDialog
          title="Delete this note?"
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            setAskDelete(false);
            await onDelete(entry);
          }}
          onCancel={() => setAskDelete(false)}
        >
          <p>
            This removes it from this device for good. If you made a backup file, the note stays in
            that file.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
