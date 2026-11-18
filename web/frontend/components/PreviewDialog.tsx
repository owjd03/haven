"use client";

import { Button } from "@/components/ui";
import { applyMasks, type Entity } from "@haven/backend";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ShieldPrep } from "@/lib/shield";

interface Props {
  title: string;
  prep: ShieldPrep | null;
  sending: boolean;
  error: string | null;
  onSend: (masked: string, map: Record<string, string>) => void;
  onCancel: () => void;
}

const WORD_RE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;
const maskClass =
  "rounded bg-warn-bg px-1 text-warn-ink underline decoration-dotted underline-offset-2";

function WordButtons({ value, onPick }: { value: string; onPick: (word: string) => void }) {
  return (
    <>
      {value.split(/(\s+)/).map((tok, i) => {
        if (!tok || /^\s+$/.test(tok)) return tok;
        const m = WORD_RE.exec(tok);
        const core = m?.[2] ?? "";
        if (!m || !core) return tok;
        return (
          <span key={i}>
            {m[1]}
            <button
              type="button"
              onClick={() => onPick(core)}
              className="rounded hover:bg-accent-soft focus-visible:bg-accent-soft"
              aria-label={`Hide "${core}"`}
            >
              {core}
            </button>
            {m[3]}
          </span>
        );
      })}
    </>
  );
}

function Body({ prep, sending, error, onSend, onCancel, title }: Props & { prep: ShieldPrep }) {
  const [entries, setEntries] = useState<Entity[]>(prep.entries);
  const [weakOk, setWeakOk] = useState(false);
  const result = useMemo(() => applyMasks(prep.original, entries), [prep.original, entries]);
  const count = Object.keys(result.map).length;

  const hide = (word: string) => setEntries((p) => [...p, { text: word, kind: "ITEM" }]);
  const show = (original: string) =>
    setEntries((p) => p.filter((e) => e.text.toLowerCase() !== original.toLowerCase()));

  const blocked = sending || (prep.weak && !weakOk);

  return (
    <>
      <p className="mt-2 text-muted">
        Nothing is sent until you press <strong>Send to cloud</strong>. Tap any word on the left to
        hide it, or tap a highlighted item to show it again.
      </p>

      {prep.weak && (
        <div role="alert" className="mt-4 rounded-xl bg-warn-bg p-4 text-warn-ink">
          <p className="font-medium">Detection is weaker on this device.</p>
          <p className="mt-1">
            The private model isn&apos;t available, so Haven can only find emails, phone numbers and
            links automatically. Names and places may be missed. Please read the left side and tap
            anything personal to hide it.
          </p>
          <label className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              checked={weakOk}
              onChange={(e) => setWeakOk(e.target.checked)}
              className="mt-1.5"
            />
            <span>I understand, and I&apos;ve checked the text myself.</span>
          </label>
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section aria-labelledby="orig-h" className="rounded-xl border border-line p-4">
          <h3 id="orig-h" className="font-medium">
            What you wrote
          </h3>
          <p className="mt-2 max-h-72 overflow-y-auto leading-8 break-words whitespace-pre-wrap">
            {result.segments.map((s, i) =>
              s.type === "text" ? (
                <WordButtons key={i} value={s.value} onPick={hide} />
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => show(s.value)}
                  className={maskClass}
                  aria-label={`Show "${s.value}" to the cloud again`}
                  title="Tap to stop hiding"
                >
                  {s.value}
                </button>
              ),
            )}
          </p>
        </section>

        <section
          aria-labelledby="cloud-h"
          className="rounded-xl border border-line bg-accent-soft p-4"
        >
          <h3 id="cloud-h" className="font-medium">
            What the cloud will see
          </h3>
          <p
            className="mt-2 max-h-72 overflow-y-auto leading-8 break-words whitespace-pre-wrap"
            aria-live="polite"
          >
            {result.segments.map((s, i) =>
              s.type === "text" ? (
                <span key={i}>{s.value}</span>
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => show(s.value)}
                  className={maskClass}
                  aria-label={`${s.placeholder} stands for a hidden detail. Tap to show it.`}
                  title="Tap to show"
                >
                  {s.placeholder}
                </button>
              ),
            )}
          </p>
        </section>
      </div>

      <p className="mt-3 text-sm text-muted">
        {count === 0
          ? "No personal details are hidden."
          : `${count} detail${count === 1 ? "" : "s"} hidden.`}{" "}
        The cloud reply is un-hidden here on your device.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-danger-bg p-3 text-danger-ink">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="sm" type="button" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
        <Button type="button" onClick={() => onSend(result.masked, result.map)} disabled={blocked}>
          {sending ? "Sending…" : "Send to cloud"}
        </Button>
      </div>
      <span className="sr-only">{title}</span>
    </>
  );
}

export default function PreviewDialog(props: Props) {
  const ref = useRef<HTMLHeadingElement>(null);
  const { onCancel, sending } = props;
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !sending && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, sending]);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/50 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-title"
        className="mx-auto my-4 w-full max-w-4xl rounded-2xl border border-line bg-surface p-5 shadow-xl sm:p-6"
      >
        <h2
          id="preview-title"
          ref={ref}
          tabIndex={-1}
          className="text-2xl font-semibold outline-none"
        >
          {props.title}
        </h2>
        {props.prep ? (
          <Body {...props} prep={props.prep} />
        ) : (
          <div role="status" className="mt-6 text-muted">
            Looking for personal details on your device…
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" size="sm" type="button" onClick={props.onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
