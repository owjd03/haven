"use client";

import { Button, PageTitle } from "@/components/ui";
import { useAI } from "@/components/AIProvider";

const PRIVACY_POINTS = [
  "Chat runs in a small AI model inside your browser. Your messages never leave your computer.",
  "Extras like Insights can use the cloud, but only if you say yes, one time at a time.",
  "Before anything is sent, Haven hides names and places and shows you exactly what would go.",
];

export default function Welcome() {
  const { phase, progress, error, localStatus, configured, start, enterCloudMode } = useAI();
  const pct = Math.round(progress * 100);
  const loading = phase === "loading";
  const cantRunLocal = localStatus === "unavailable" || phase === "error";

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-12">
      <PageTitle where="private" className="text-4xl sm:text-5xl">
        A calm place to talk.
      </PageTitle>
      <p className="mt-4 max-w-prose text-lg text-muted">
        Haven is for stress and tough times. It runs privately on your device, and you stay in
        control of everything.
      </p>

      {!configured && (
        <p role="alert" className="mt-6 rounded-xl bg-warn-bg p-4 text-warn-ink">
          Firebase isn&apos;t configured yet. Copy <code>.env.example</code> to{" "}
          <code>.env.local</code> and fill it in.
        </p>
      )}

      {localStatus === "unavailable" && (
        <div role="alert" className="mt-6 rounded-xl bg-warn-bg p-4 text-warn-ink">
          <p className="font-medium">Your browser can&apos;t run the private model yet.</p>
          <details className="mt-1">
            <summary className="cursor-pointer underline underline-offset-4">
              Why can&apos;t I start?
            </summary>
            <p className="mt-2">
              Use desktop Chrome 139 or newer, enable{" "}
              <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code>, then restart
              Chrome.
            </p>
          </details>
        </div>
      )}

      <div className="mt-8">
        <Button size="lg" type="button" onClick={start} disabled={!configured || loading}>
          {loading ? "Getting ready…" : "Start chatting"}
        </Button>

        {loading && (
          <div className="mt-4" aria-live="polite">
            <div
              role="progressbar"
              aria-label="Preparing the private model"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-3 w-full overflow-hidden rounded-full bg-line"
            >
              <div
                className="h-full bg-accent transition-[width] duration-200 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-muted">
              {pct}% · The first time can take a few minutes. This only happens once.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-danger-bg p-4 text-danger-ink">
            {error}
          </p>
        )}

        {cantRunLocal && configured && (
          <div className="mt-6 rounded-xl bg-surface p-4">
            <p className="font-medium">Can&apos;t use the private model?</p>
            <p className="mt-1 text-muted">
              You can still talk to Haven through the cloud. Every message asks your permission
              first, and you always see a preview with personal details hidden before anything is
              sent.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              type="button"
              onClick={enterCloudMode}
            >
              Continue with the cloud (ask me each time)
            </Button>
          </div>
        )}
      </div>

      <section aria-labelledby="privacy-h" className="mt-12">
        <h2 id="privacy-h" className="text-xl">
          How your privacy works
        </h2>
        <ul className="mt-3 max-w-prose list-disc space-y-2 pl-5 text-muted">
          {PRIVACY_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
