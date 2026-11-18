"use client";

import { Button, PageTitle } from "@/components/ui";
import { deleteJournalEntry, getJournalEntries } from "@/lib/db";
import { defaultNoteColor } from "@/lib/journal";
import type { JournalEntry } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import NoteBoard from "./NoteBoard";
import NoteDialog, { type DialogState } from "./NoteDialog";

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [freshId, setFreshId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await getJournalEntries());
    } catch {
      setLoadError(true);
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openNew = () => {
    setStatus(null);
    setDialog({ mode: "new" });
  };

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto px-4 py-8">
      <div className="max-w-2xl">
        <PageTitle where="private">Journal</PageTitle>
        <p className="mt-2 text-muted">
          Write down how you&apos;re feeling, whenever it helps, one sticky note at a time. Notes
          are saved only on this device, and nothing reads them unless you ask for Insights.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h2 className="text-2xl">Your notes</h2>
        <Button ref={newButton} size="sm" onClick={openNew}>
          New note
        </Button>
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      </div>

      {loadError && (
        <p role="alert" className="mt-3 rounded-xl bg-danger-bg p-4 text-danger-ink">
          Couldn&apos;t open your journal. Your browser may be blocking storage.
        </p>
      )}
      {entries === null ? (
        <p className="mt-3 text-muted" role="status">
          Opening your journal…
        </p>
      ) : (
        <NoteBoard
          entries={entries}
          freshId={freshId}
          onOpen={(entry) => {
            setStatus(null);
            setDialog({ mode: "view", entry });
          }}
          onCreate={openNew}
        />
      )}

      {entries !== null && (
        <p className="mt-10 max-w-2xl text-muted">
          Want a gentle look back at your notes?{" "}
          <Link href="/insights" className="font-medium text-ink underline underline-offset-4">
            See patterns in Insights
          </Link>
          . It asks you first, and shows exactly what would be sent.
        </p>
      )}

      {dialog && (
        <NoteDialog
          // A new key per note means a clean form each time, never leftovers from the last one.
          key={dialog.mode === "new" ? "new" : dialog.entry.id}
          state={dialog}
          defaultColor={defaultNoteColor(entries?.length ?? 0)}
          fallbackFocus={() => newButton.current}
          onClose={() => setDialog(null)}
          onSaved={(saved, message) => {
            setFreshId(saved.id ?? null);
            setStatus(message);
            setDialog(null);
            void load();
          }}
          onDelete={async (entry) => {
            await deleteJournalEntry(entry.id!);
            setStatus("Note deleted.");
            setDialog(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
