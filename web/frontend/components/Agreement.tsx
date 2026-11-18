"use client";

import { useEffect, useRef, useState } from "react";
import { useCrisis } from "./CrisisProvider";
import { Button } from "./ui";

const FEATURES = [
  {
    name: "Journal",
    text: "Write how you feel and rate your day.",
    tag: "Private",
  },
  {
    name: "Chat",
    text: "Talk things through, either just to be heard or to think it over.",
    tag: "Private",
  },
  {
    name: "About me",
    text: "Things you’d like Haven to remember about your life.",
    tag: "Private",
  },
  {
    name: "Insights",
    text: "A gentle look back at your notes from the last 7 or 30 days.",
    tag: "Cloud",
  },
  {
    name: "Write a message",
    text: "Help putting a hard message into words.",
    tag: "Private",
  },
  {
    name: "Small steps",
    text: "A 4-week plan of everyday things that may help, built with you.",
    tag: "Cloud",
  },
  {
    name: "Settings",
    text: "Text size, theme, backups and your data.",
    tag: "Private",
  },
];

const PRIVACY_POINTS = [
  "Chat runs in a small AI model inside your browser. Your messages never leave your computer.",
  "Extras like Insights can use the cloud, but only if you say yes, one time at a time.",
  "Before anything is sent, Haven hides names and places and shows you exactly what would go.",
];

/** The opening page, shown once. Nothing else in Haven opens until the person agrees. */
export default function Agreement({ onAgree }: { onAgree: () => void }) {
  const { triggerCrisis } = useCrisis();
  const [checked, setChecked] = useState(false);
  // The scroll prompt shows until the agreement itself has come into view.
  const endRef = useRef<HTMLElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setAtEnd(e.isIntersecting), { threshold: 0.6 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const scrollToEnd = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  };
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-4xl tracking-tight sm:text-5xl">Welcome to Haven</h1>
      <p className="mt-4 max-w-prose text-lg text-muted">
        Haven is a quiet place for stress and tough times. Please read this once before you begin.
      </p>

      <section aria-labelledby="disclaimer" className="mt-8 rounded-xl border border-line p-5">
        <h2 id="disclaimer" className="text-lg font-semibold">
          Haven is not a substitute for professional help.
        </h2>
        <p className="mt-2 leading-relaxed">
          It&apos;s a companion for everyday stress, not a doctor, therapist or counsellor. It
          can&apos;t diagnose, treat or give medical advice. If you&apos;re in danger or thinking
          about harming yourself, contact your local emergency number or a crisis line now.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => triggerCrisis("browse")}
        >
          Find a support line
        </Button>
      </section>

      <section aria-labelledby="features" className="mt-12">
        <h2 id="features" className="text-2xl">
          What you can do here
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.name} className="rounded-xl border border-line p-4">
              <span className="flex items-center justify-between gap-3">
                <span className="text-lg font-medium">{f.name}</span>
                <span className="text-sm whitespace-nowrap text-muted">{f.tag}</span>
              </span>
              <span className="mt-1 block text-muted">{f.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="privacy" className="mt-12">
        <h2 id="privacy" className="text-2xl">
          How your privacy works
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5">
          {PRIVACY_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>

      <section ref={endRef} aria-label="Agreement" className="mt-12 border-t border-line pt-8">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
          />
          <span className="leading-relaxed">
            I understand that Haven is not a substitute for professional help, and I agree to use it
            on that basis.
          </span>
        </label>
        <Button size="lg" className="mt-6" disabled={!checked} onClick={onAgree}>
          Continue
        </Button>
      </section>
      {!atEnd && (
        <button
          type="button"
          onClick={scrollToEnd}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface px-5 py-2.5 text-sm text-muted shadow-sm hover:text-ink"
        >
          Scroll down to read everything &darr;
        </button>
      )}
    </div>
  );
}
