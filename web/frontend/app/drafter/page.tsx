"use client";

import { Button, Input, Select, Textarea, PageTitle } from "@/components/ui";
import { detectCrisis } from "@haven/backend";
import { useState, type FormEvent } from "react";
import { toHavenError } from "@/lib/ai";
import { useCrisis } from "@/components/CrisisProvider";
import { useShield } from "@/components/ShieldProvider";

const TONES = ["warm", "calm and direct", "apologetic", "firm but kind"];

function instructionFor(tone: string): string {
  return (
    "You help someone write a message to a person in their life. Draft a short, thoughtful, honest message from the user, in the first person, " +
    `in a ${tone} tone. Use only the facts they gave; don't invent details or promises. Output only the message itself, with no preface and no explanation.`
  );
}

export default function DrafterPage() {
  const { triggerCrisis } = useCrisis();
  const { runShielded } = useShield();
  const [who, setWho] = useState("");
  const [what, setWhat] = useState("");
  const [tone, setTone] = useState(TONES[0]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = `Who I'm writing to: ${who.trim()}\nWhat I want to say: ${what.trim()}`;
    // Same safety rule as chat: crisis language never goes to any model.
    if (detectCrisis(`${who} ${what}`).matched) {
      setWho("");
      setWhat("");
      triggerCrisis();
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await runShielded({
        text,
        instruction: instructionFor(tone),
        title: "Review what the cloud will see for your draft",
      });
      if (!r) setNote("Okay, nothing was sent.");
      else {
        setDraft(r.text.trim());
        if (r.altered)
          setNote(
            "Some private details in the draft couldn't be restored, so I left them generic. Please check it.",
          );
      }
    } catch (err) {
      setError(toHavenError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-8">
      <PageTitle where="cloud">Write a message</PageTitle>
      <p className="mt-2 text-muted">
        Not sure how to say something? Tell Haven who it&apos;s for and what you want to say, and it
        will draft a message you can edit. This uses the cloud, so you&apos;ll preview what&apos;s
        sent, with names and places hidden, first.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="who" className="block font-medium">
            Who do you want to write to?
          </label>
          <Input
            className="mt-1 w-full"
            id="who"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            maxLength={200}
            placeholder="e.g. my best friend Sam"
          />
        </div>
        <div>
          <label htmlFor="what" className="block font-medium">
            What do you want to say?
          </label>
          <Textarea
            className="mt-1 w-full resize-y"
            id="what"
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="e.g. I'm sorry I stopped replying. I was overwhelmed, and I miss talking."
          />
        </div>
        <div>
          <label htmlFor="tone" className="block font-medium">
            Tone
          </label>
          <Select
            className="mt-1 w-full"
            id="tone"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
          >
            {TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
        <Button size="lg" type="submit" disabled={busy || !who.trim() || !what.trim()}>
          {busy ? "Working…" : "Draft it (review first)"}
        </Button>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-danger-bg p-4 text-danger-ink">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="mt-4 rounded-xl bg-accent-soft p-4">
          {note}
        </p>
      )}

      {draft && (
        <section aria-labelledby="draft-h" className="mt-6 rounded-xl bg-surface p-5">
          <h2 id="draft-h" className="text-xl font-medium">
            Your draft
          </h2>
          <label htmlFor="draft" className="sr-only">
            Edit your draft
          </label>
          <Textarea
            tone="bg"
            className="mt-2 w-full resize-y"
            id="draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
          />
          <div className="mt-3 flex items-center gap-3">
            <Button variant="secondary" size="xs" type="button" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <p className="text-xs text-muted">
              Edit it until it sounds like you. Nothing is sent anywhere from here.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
