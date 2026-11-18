"use client";

import { Button, Input, PageTitle } from "@/components/ui";
import { useEffect, useState, type FormEvent } from "react";
import { detectCrisis } from "@haven/backend";
import { addFact, getProfile, removeFact } from "@/lib/storage";
import type { ProfileFact } from "@/lib/types";
import { useCrisis } from "@/components/CrisisProvider";

export default function ProfilePage() {
  const [facts, setFacts] = useState<ProfileFact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const { triggerCrisis } = useCrisis();

  // localStorage only exists in the browser; read after mount to avoid a hydration mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFacts(getProfile().facts);
    setLoaded(true);
  }, []);

  function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    // Notes are included in model prompts, so they get the same crisis check (and are not saved).
    if (detectCrisis(text).matched) {
      setText("");
      triggerCrisis();
      return;
    }
    setFacts(addFact(text).facts);
    setText("");
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-8">
      <PageTitle where="private">About me</PageTitle>
      <p className="mt-2 text-muted">
        What&apos;s going on in your life right now? Haven reads these notes to understand you
        better. They are saved only on this device, and you can change them any time.
      </p>

      <form onSubmit={onAdd} className="mt-6 flex gap-2">
        <label htmlFor="fact-input" className="sr-only">
          Add something about what&apos;s going on
        </label>
        <Input
          radius="full"
          className="min-w-0 flex-1"
          id="fact-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder="e.g. Finals start next week and I'm behind"
        />
        <Button type="submit" disabled={!text.trim()}>
          Add
        </Button>
      </form>

      {loaded && facts.length === 0 ? (
        <div className="mt-8 rounded-xl bg-surface p-6 text-center text-muted">
          Nothing here yet. Add a few notes about what you&apos;re dealing with, and Haven will keep
          them in mind.
        </div>
      ) : (
        <ul className="mt-6 space-y-2" aria-label="Your notes">
          {facts.map((f) => (
            <li
              key={f.id}
              className="flex items-start justify-between gap-3 rounded-xl bg-surface px-4 py-3"
            >
              <span>
                {f.text}
                {f.source === "suggested" && (
                  <span className="ml-2 text-xs text-muted">· kept from chat</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setFacts(removeFact(f.id).facts)}
                aria-label={`Remove: ${f.text}`}
                className="shrink-0 rounded-lg px-3 py-1 text-sm text-muted hover:bg-line hover:text-ink"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
