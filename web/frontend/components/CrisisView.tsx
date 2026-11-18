"use client";

import { Button, Input, Select } from "@/components/ui";
import { isPlaceholder, matchCountry, telNumber, type HotlineData } from "@haven/backend";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { guessCountryCode, loadHotlines } from "@/lib/hotlines";
import { getCountry, setCountry } from "@/lib/storage";

function NumberText({ text }: { text: string }) {
  const tel = telNumber(text);
  return tel ? (
    <a href={`tel:${tel}`} className="font-medium underline">
      {text}
    </a>
  ) : (
    <span className="font-medium">{text}</span>
  );
}

export type CrisisVariant = "alert" | "browse";

export default function CrisisView({
  onClose,
  variant = "alert",
}: {
  onClose: () => void;
  variant?: CrisisVariant;
}) {
  const [data, setData] = useState<HotlineData | null>(null);
  const [code, setCode] = useState<string>("");
  const [place, setPlace] = useState("");
  const [placeNote, setPlaceNote] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const browse = variant === "browse";

  useEffect(() => {
    let alive = true;
    loadHotlines().then((d) => {
      if (!alive) return;
      setData(d);
      const saved = getCountry();
      setCode(saved && d.countries.some((c) => c.code === saved) ? saved : guessCountryCode(d));
    });
    headingRef.current?.focus();
    return () => {
      alive = false;
    };
  }, []);

  const country = data?.countries.find((c) => c.code === code);

  // Plain string matching against the built-in list. No model is used on this screen.
  function findPlace(e: FormEvent) {
    e.preventDefault();
    if (!data || !place.trim()) return;
    const hit = matchCountry(place, data);
    if (hit) {
      setCode(hit.code);
      setCountry(hit.code); // only the country code is remembered, never what was typed
      setPlaceNote(`Showing support lines for ${hit.name}.`);
    } else {
      setCode("OTHER");
      setPlaceNote(
        "We don't have that place in our list yet. Here's an international directory you can use.",
      );
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="crisis-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-bg"
    >
      <div className="mx-auto max-w-2xl px-5 py-10">
        <h1
          id="crisis-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-semibold tracking-tight outline-none"
        >
          {browse
            ? "Support, whenever you want it"
            : "You don\u2019t have to go through this alone"}
        </h1>
        <p className="mt-3 text-lg">
          {browse
            ? "These are people you can reach at any time. You don\u2019t have to be in crisis to talk to them."
            : "What you wrote sounds really painful, and it matters. Haven can\u2019t help with this safely, so we\u2019re pausing here. Please reach out to a real person right now."}
        </p>

        <section className="mt-6 rounded-xl bg-surface p-5" aria-labelledby="trust-title">
          <h2 id="trust-title" className="text-xl font-medium">
            Talk to someone you trust now
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Call, text, or go find a friend, family member, teacher, or counselor and tell them
              you&apos;re struggling.
            </li>
            <li>
              You don&apos;t need the right words. &quot;I&apos;m not okay and I need help&quot; is
              enough.
            </li>
            <li>
              If you might act on these thoughts, or you&apos;re in immediate danger, call your
              local emergency number now.
            </li>
            <li>
              If you can, move away from anything you could use to hurt yourself, and stay near
              other people.
            </li>
          </ul>
        </section>

        <section className="mt-4 rounded-xl bg-surface p-5" aria-labelledby="help-title">
          <h2 id="help-title" className="text-xl font-medium">
            Crisis support lines
          </h2>

          <form onSubmit={findPlace} className="mt-3">
            <label htmlFor="place" className="block text-sm text-muted">
              Where are you? (country or city)
            </label>
            <div className="mt-1 flex gap-2">
              <Input
                tone="bg"
                className="min-w-0 flex-1"
                id="place"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder="e.g. Canada"
              />
              <Button type="submit" disabled={!place.trim()}>
                Find
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted">
              Used only to pick a list on your device. It isn&apos;t saved or sent anywhere.
            </p>
            {placeNote && (
              <p role="status" className="mt-2 text-sm">
                {placeNote}
              </p>
            )}
          </form>

          <label htmlFor="country" className="mt-4 block text-sm text-muted">
            Or choose your country
          </label>
          <Select
            tone="bg"
            className="mt-1 w-full"
            id="country"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCountry(e.target.value);
            }}
          >
            {data?.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>

          {country && (
            <div className="mt-4 space-y-4" aria-live="polite">
              {country.emergency && (
                <p>
                  <span className="text-muted">
                    If you or someone else is in immediate danger, call:{" "}
                  </span>
                  <NumberText text={country.emergency} />
                </p>
              )}
              {country.lines.some((l) => l.phone && !isPlaceholder(l.phone)) && (
                <div className="rounded-xl bg-accent-soft p-4">
                  <p className="font-medium">Crisis and suicide prevention lines</p>
                  <ul className="mt-2 space-y-1.5">
                    {country.lines
                      .filter((l) => l.phone && !isPlaceholder(l.phone))
                      .map((l, i) => (
                        <li key={i}>
                          <NumberText text={l.phone!} />
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              {country.lines
                .filter((l) => l.url && !isPlaceholder(l.url))
                .map((l, i) => (
                  <p key={`u${i}`}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium underline"
                    >
                      {l.name}
                    </a>
                    {l.notes && <span className="text-muted"> · {l.notes}</span>}
                  </p>
                ))}
              {data?.sources?.length ? (
                <p className="text-xs text-muted">
                  Numbers come from {data.sources.map((x) => x.name).join(" and ")}
                  {data.retrievedAt ? ` (retrieved ${data.retrievedAt})` : ""} and may be out of
                  date or incomplete. Please double-check a number before relying on it.
                </p>
              ) : null}
            </div>
          )}
          {data?.directoryUrl && (
            <p className="mt-4 text-sm">
              Not in the list?{" "}
              <a
                href={data.directoryUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium underline"
              >
                Find a helpline in any country
              </a>
              .
            </p>
          )}
        </section>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button variant="secondary" className="bg-surface" type="button" onClick={onClose}>
            I&apos;m safe right now. Back to Haven
          </Button>
        </div>

        <p className="mt-8 text-sm text-muted">
          Haven is a supportive companion, not a substitute for professional care. It can&apos;t
          diagnose or treat.
        </p>
      </div>
    </div>
  );
}
