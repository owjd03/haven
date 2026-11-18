"use client";

import { Button, cx, PageTitle } from "@/components/ui";
import { useCrisis } from "@/components/CrisisProvider";
import { useShield } from "@/components/ShieldProvider";
import { toHavenError } from "@/lib/ai";
import {
  buildInsights,
  INSIGHT_RANGES,
  insightsInstruction,
  listInsightItems,
  loadInsightInput,
  meterInfo,
  showsLowMoodNote,
  type GatheredInsights,
  type InsightInput,
  type InsightItem,
} from "@/lib/insights";
import { getInsightChoices, saveInsightChoices, type InsightChoices } from "@/lib/storage";
import { useEffect, useMemo, useRef, useState } from "react";
import ChoiceBar from "./ChoiceBar";
import ItemDialog from "./ItemDialog";
import ItemList from "./ItemList";
import WordMeter from "./WordMeter";

interface Result {
  text: string;
  /** What the reply was based on, so it's clear what the cloud saw. */
  basedOn: string;
  days: number;
  lowMood: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function sourceWords(c: Pick<InsightChoices, "journal" | "chats">): string {
  if (c.journal && c.chats) return "your chats and journal";
  return c.journal ? "your journal" : "your chats";
}

export default function InsightsPage() {
  const { runShielded } = useShield();
  const { triggerCrisis } = useCrisis();
  const [choices, setChoices] = useState<InsightChoices>({ days: 7, journal: true, chats: true });
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState<InsightInput | undefined>(undefined);
  /** Which items are selected. Everything starts selected and resets when the range or sources change. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [reading, setReading] = useState<InsightItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  // On a phone the result lands below the lists, so bring it into view. On a wider screen it opens
  // at the top of the panel's own scrolling area, right beside the choices, so nothing needs to move.
  useEffect(() => {
    if (!result || window.matchMedia("(min-width: 768px)").matches) return;
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [result]);

  // Saved choices live in localStorage, which only exists in the browser.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoices(getInsightChoices());
    setReady(true);
  }, []);

  // Everything here is worked out on the device. Nothing is sent until the person confirms the preview.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInput(undefined);
    setReading(null);
    loadInsightInput(choices.days, choices).then(
      (loaded) => {
        if (!alive) return;
        setSelected(
          new Set(
            listInsightItems(loaded)
              .filter((i) => !i.locked)
              .map((i) => i.id),
          ),
        );
        setInput(loaded);
      },
      () => alive && setInput(undefined),
    );
    return () => {
      alive = false;
    };
  }, [ready, choices]);

  const items = useMemo(() => (input ? listInsightItems(input) : []), [input]);
  const gathered: GatheredInsights | undefined = useMemo(
    () => (input ? buildInsights(input, selected) : undefined),
    [input, selected],
  );
  const wontFit = useMemo(() => new Set(gathered?.wontFit ?? []), [gathered]);

  function change(next: InsightChoices) {
    setChoices(next);
    saveInsightChoices(next);
    setResult(null);
    setNote(null);
    setError(null);
  }

  const label = INSIGHT_RANGES.find((r) => r.days === choices.days)?.label.toLowerCase();
  const hasText = !!gathered && gathered.text !== "";

  async function generate() {
    if (!gathered || !hasText) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await runShielded({
        text: gathered.text,
        instruction: insightsInstruction(gathered.text, choices),
        title: "Review what the cloud will see for your insights",
      });
      if (!r) setNote("Okay, nothing was sent.");
      else {
        setResult({
          text: r.text.trim(),
          basedOn: sourceWords(choices),
          days: choices.days,
          lowMood: choices.journal && showsLowMoodNote(gathered),
        });
        if (r.altered)
          setNote(
            "Some private details in the reply couldn't be restored, so they were left generic.",
          );
      }
    } catch (e) {
      setError(toHavenError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(result?.text ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the text is selectable */
    }
  }

  /** One plain line about what is ready. The word meter carries the numbers and the notes. */
  function status(g: GatheredInsights): string {
    const anySelectable = items.some((i) => !i.locked);
    if (g.text === "") {
      if (!anySelectable)
        return g.excluded > 0
          ? `Nothing can be sent for the ${label}.`
          : `Nothing from ${sourceWords(choices)} in the ${label} yet.`;
      return "Nothing is selected. Tick at least one item to send.";
    }
    const parts: string[] = [];
    if (g.journalEntries > 0)
      parts.push(plural(g.journalEntries, "journal entry", "journal entries"));
    if (g.chatDays > 0) parts.push(`${plural(g.chatDays, "day", "days")} of chats`);
    return `Ready: ${parts.join(" and ")} from the ${label}.`;
  }

  const both = choices.journal && choices.chats;
  const journalItems = items.filter((i) => i.kind === "journal");
  const chatItems = items.filter((i) => i.kind !== "journal");
  const listProps = { selected, wontFit, onChange: setSelected, onRead: setReading };
  const actionLabel = busy ? "Working…" : "Get insights";

  return (
    // No overflow here: the page scrolls in the shell, so the panel can stick to its top edge.
    // In px, not rem, so the Smaller text size never leaves more of a wide screen empty.
    <div className="mx-auto max-w-[1600px] px-4 pt-8 pb-4 md:px-6 md:pb-8">
      {/* The top of the page is centred, so it sits over the whole width instead of hugging the left. */}
      <header className="flex flex-col items-center text-center">
        <PageTitle where="cloud" centered>
          Insights
        </PageTitle>
        <p className="mt-2 text-muted">
          A gentle look back at your notes and chats. Nothing leaves this device until you press
          Send.
        </p>
        <ChoiceBar choices={choices} onChange={change} />
      </header>

      <div className="mt-5 grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className={cx("grid min-w-0 gap-5", both && "xl:grid-cols-2")}>
          {!gathered && (
            <p className="text-muted" role="status">
              Looking at your notes…
            </p>
          )}
          {gathered && choices.journal && (
            <ItemList
              title="Journal notes"
              items={journalItems}
              twoColumns={!both}
              {...listProps}
            />
          )}
          {gathered && choices.chats && (
            <ItemList title="Chats" items={chatItems} twoColumns={!both} {...listProps} />
          )}
        </div>

        <aside
          aria-label="Your insights"
          className="rounded-xl border border-line bg-surface p-4 md:sticky md:top-4 md:flex md:max-h-[calc(100dvh-8rem)] md:flex-col"
        >
          {/* This part stays put; only the result below scrolls, so the button is always in reach. */}
          <div className="md:shrink-0">
            <h2 className="text-lg font-medium">Your insights</h2>
            <p className="mt-1 text-sm text-muted" role="status">
              {gathered === undefined ? "Looking at your notes…" : status(gathered)}
            </p>
            {gathered && (
              <div className="mt-3">
                <WordMeter g={gathered} />
              </div>
            )}

            {/* On a phone this button lives in the bottom bar instead. */}
            <Button
              size="lg"
              className="mt-4 hidden w-full md:block"
              onClick={generate}
              disabled={busy || !hasText}
            >
              {actionLabel}
            </Button>
            <p className="mt-2 text-xs text-muted">
              Names and places are hidden first, and you&apos;ll review exactly what would be sent
              before anything leaves this device.
            </p>

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
          </div>

          {result && (
            <div
              ref={resultRef}
              className="mt-5 scroll-mt-4 md:min-h-0 md:flex-1 md:overflow-y-auto"
            >
              {result.lowMood && (
                <div role="note" className="mb-4 rounded-xl bg-warn-bg p-4 text-warn-ink">
                  <p>
                    It looks like it&apos;s been a hard stretch. Talking to someone you trust, or a
                    counselor, can really help.
                  </p>
                  <Button
                    variant="secondary"
                    size="xs"
                    className="mt-2"
                    onClick={() => triggerCrisis("browse")}
                  >
                    Find a support line
                  </Button>
                </div>
              )}
              <article aria-labelledby="insight-result-h" className="rounded-xl bg-bg p-4">
                <h3 id="insight-result-h" className="text-lg">
                  A gentle look back
                </h3>
                <p className="mt-2 whitespace-pre-wrap">{result.text}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button variant="secondary" size="xs" onClick={copy}>
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <p className="text-xs text-muted">
                    Made with the cloud, with your permission, from {result.basedOn} (last{" "}
                    {result.days} days). It&apos;s a reflection, not advice or a diagnosis, and it
                    can be wrong. It isn&apos;t saved.
                  </p>
                </div>
              </article>
            </div>
          )}
        </aside>
      </div>

      {/* Phone: the word count and the button stay in reach while the lists scroll. Sticky, not fixed,
          so at the end of the page it rests above the disclaimer instead of covering it. */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-5 -mb-4 flex items-center gap-3 border-t border-line bg-bg px-4 py-3 md:hidden">
        <span aria-hidden className="min-w-0 flex-1 text-sm font-medium">
          {gathered ? meterInfo(gathered).label : "Looking…"}
        </span>
        <Button onClick={generate} disabled={busy || !hasText}>
          {actionLabel}
        </Button>
      </div>

      {reading && <ItemDialog item={reading} onClose={() => setReading(null)} />}
    </div>
  );
}
