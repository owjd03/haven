"use client";

import { useEffect, useState } from "react";
import {
  chat,
  cloudGenerate,
  CLOUD_MODEL,
  getLocalStatus,
  initLocalModel,
  toHavenError,
  type AIResult,
  type LocalStatus,
} from "@/lib/ai";
import { isFirebaseConfigured } from "@/lib/firebase";

type Phase = "idle" | "loading" | "ready" | "error";

export default function Phase1Demo() {
  const [status, setStatus] = useState<LocalStatus | "checking">("checking");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"local" | "cloud" | null>(null);
  const [localOut, setLocalOut] = useState<AIResult | null>(null);
  const [cloudOut, setCloudOut] = useState<AIResult | null>(null);
  const [cloudConsent, setCloudConsent] = useState(false);
  const configured = isFirebaseConfigured();

  useEffect(() => {
    getLocalStatus().then(setStatus);
  }, []);

  async function start() {
    setError(null);
    setPhase("loading");
    setProgress(0);
    try {
      await initLocalModel((f) => setProgress(f));
      setProgress(1);
      setPhase("ready");
      setStatus("available");
    } catch (e) {
      setError(toHavenError(e).message);
      setPhase("error");
    }
  }

  async function testLocal() {
    setBusy("local");
    setError(null);
    try {
      setLocalOut(
        await chat("In one short, warm sentence, say hello to someone starting their day."),
      );
    } catch (e) {
      setError(toHavenError(e).message);
    } finally {
      setBusy(null);
    }
  }

  async function testCloud() {
    setBusy("cloud");
    setError(null);
    try {
      // Fixed, harmless test text: no user data leaves the device in Phase 1.
      setCloudOut(
        await cloudGenerate(
          "In one short, warm sentence, say hello to someone starting their day.",
        ),
      );
    } catch (e) {
      setError(toHavenError(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-xl flex-col gap-6 overflow-y-auto px-5 py-8">
      <header>
        <h1 className="text-3xl font-semibold">Debug</h1>
        <p className="mt-1 text-base opacity-80">
          Phase 1 check: prove Gemini Nano (on-device) and the cloud model both work through
          Firebase AI Logic.
        </p>
      </header>

      {!configured && (
        <p
          role="alert"
          className="rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Firebase isn&apos;t configured. Copy <code>.env.example</code> to <code>.env.local</code>{" "}
          and fill in your web app config.
        </p>
      )}

      <section aria-label="On-device model" className="rounded-xl border border-black/10 p-4">
        <h2 className="text-lg font-medium">1. On-device (private)</h2>
        <p className="text-sm opacity-70">
          Chrome Prompt API status: <strong>{status}</strong>
        </p>

        <button
          onClick={start}
          disabled={!configured || phase === "loading" || phase === "ready"}
          className="mt-3 rounded-full bg-teal-700 px-5 py-2 text-white disabled:opacity-50"
        >
          {phase === "ready"
            ? "Model ready"
            : phase === "loading"
              ? "Preparing…"
              : "Start chatting"}
        </button>

        {phase === "loading" && (
          <div className="mt-3">
            <div
              role="progressbar"
              aria-label="Model download progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className="h-3 w-full overflow-hidden rounded-full bg-black/10"
            >
              <div
                className="h-full bg-teal-600 transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-sm opacity-70">
              {Math.round(progress * 100)}% (first run can take several minutes)
            </p>
          </div>
        )}

        <button
          onClick={testLocal}
          disabled={phase !== "ready" || busy !== null}
          className="mt-3 ml-0 block rounded-full border border-teal-700 px-5 py-2 text-teal-800 disabled:opacity-50"
        >
          {busy === "local" ? "Thinking…" : "Run on-device test prompt"}
        </button>
        {localOut && (
          <p className="mt-3 rounded-lg bg-black/5 p-3 text-sm">
            <strong>[{localOut.source}]</strong> {localOut.text}
          </p>
        )}
      </section>

      <section aria-label="Cloud model" className="rounded-xl border border-black/10 p-4">
        <h2 className="text-lg font-medium">2. Cloud ({CLOUD_MODEL})</h2>
        <p className="text-sm opacity-70">
          Sends only a fixed test sentence. Never your messages in this phase.
        </p>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={cloudConsent}
            onChange={(e) => setCloudConsent(e.target.checked)}
          />
          I agree to send this fixed test sentence to the cloud.
        </label>
        <button
          onClick={testCloud}
          disabled={!configured || !cloudConsent || busy !== null}
          className="mt-3 rounded-full border border-teal-700 px-5 py-2 text-teal-800 disabled:opacity-50"
        >
          {busy === "cloud" ? "Thinking…" : "Run cloud test prompt"}
        </button>
        {cloudOut && (
          <p className="mt-3 rounded-lg bg-black/5 p-3 text-sm">
            <strong>[{cloudOut.source}]</strong> {cloudOut.text}
          </p>
        )}
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500 bg-red-50 p-3 text-sm text-red-900"
        >
          {error}
        </p>
      )}
    </div>
  );
}
