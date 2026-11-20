"use client";

import { Button } from "@/components/ui";
import { validateBackup, type HavenBackup } from "@haven/backend";
import { useEffect, useRef, useState } from "react";
import { getAllMessages, getAllSummaries, getJournalEntries } from "@/lib/db";
import { applyAppearance } from "@/lib/appearance";
import {
  clearAppCache,
  deleteEverything,
  downloadBackup,
  exportAll,
  importBackup,
} from "@/lib/dataTransfer";
import { getProfile } from "@/lib/storage";
import ConfirmDialog from "@/components/ConfirmDialog";

type Msg = { kind: "ok" | "error"; text: string } | null;

export default function PrivacyView() {
  const [counts, setCounts] = useState<{
    messages: number;
    summaries: number;
    notes: number;
    journal: number;
  } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, setPending] = useState<HavenBackup | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const [m, s, j] = await Promise.all([
        getAllMessages(),
        getAllSummaries(),
        getJournalEntries(),
      ]);
      setCounts({
        messages: m.length,
        summaries: s.length,
        notes: getProfile().facts.length,
        journal: j.length,
      });
    } catch {
      setCounts(null);
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, []);

  async function onDownload() {
    try {
      downloadBackup(await exportAll());
      setMsg({
        kind: "ok",
        text: "Your backup was downloaded as haven-backup.json. It's a plain file on your device.",
      });
    } catch {
      setMsg({ kind: "error", text: "Couldn't create the backup." });
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setMsg(null);
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("big");
      const v = validateBackup(JSON.parse(await file.text()));
      if (!v.ok)
        setMsg({
          kind: "error",
          text: `That file can't be restored: ${v.errors.slice(0, 3).join(" ")}`,
        });
      else setPending(v.backup);
    } catch {
      setMsg({ kind: "error", text: "That file couldn't be read as a Haven backup." });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function doRestore() {
    if (!pending) return;
    try {
      await importBackup(pending);
      applyAppearance();
      setMsg({
        kind: "ok",
        text: `Restored ${pending.messages.length} messages, ${pending.summaries.length} summaries, ${pending.journal.length} journal entries and ${pending.profile.facts.length} notes.`,
      });
      await refresh();
    } catch {
      setMsg({ kind: "error", text: "Restoring failed. Your previous data may be unchanged." });
    } finally {
      setPending(null);
    }
  }

  async function onClearCache() {
    setMsg(null);
    try {
      await clearAppCache();
      setMsg({
        kind: "ok",
        text: "App cache cleared. Your chats, journal, notes and settings were kept. Reloading…",
      });
      setTimeout(() => window.location.reload(), 900);
    } catch {
      setMsg({
        kind: "error",
        text: "Couldn't clear the app cache. You can also clear this site's data in your browser settings.",
      });
    }
  }

  async function doDelete() {
    setConfirmDelete(false);
    try {
      await deleteEverything();
      applyAppearance();
      // Back to the opening page, as for a new visitor. A full page load, so nothing from before stays in memory.
      window.location.assign("/");
    } catch {
      setMsg({
        kind: "error",
        text: "Couldn't delete everything. Try clearing this site's data in your browser settings.",
      });
    }
  }

  return (
    <section id="data-privacy" aria-labelledby="dp-h" className="mt-12 border-t border-line pt-8">
      <h2 id="dp-h" className="text-2xl font-semibold tracking-tight">
        Data &amp; privacy
      </h2>

      <section aria-labelledby="how-h" className="mt-6 space-y-4">
        <h3 id="how-h" className="text-xl font-semibold">
          How Haven handles your data
        </h3>

        <div className="rounded-xl bg-surface p-5">
          <h4 className="text-lg font-medium">Stays on your device</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            <li>
              Your chats, summaries, journal entries and mood ratings, notes and settings are saved
              only in this browser (IndexedDB and local storage). There are no accounts and no Haven
              server.
            </li>
            <li>
              Everyday replies come from a small AI model (Gemini Nano) running inside Chrome. Those
              messages never go over the internet.
            </li>
            <li>
              Haven can notice a lasting detail in what you write, like an upcoming exam, and ask{" "}
              <em>Remember this?</em> using the same private model. Nothing is saved unless you
              press Keep. Kept notes appear in About me, where you can remove them. Health details
              are never suggested.
            </li>
            <li>
              If a message contains self-harm language, no AI sees it, and it isn&apos;t saved.
              Haven shows a support screen instead. In your journal you can choose to keep such an
              entry just for yourself: it stays on this device and is never sent to any AI.
            </li>
          </ul>
        </div>

        <div className="rounded-xl bg-surface p-5">
          <h4 className="text-lg font-medium">What can go to the cloud, only when you choose</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            <li>
              <strong>A chat message</strong>, only if your device can&apos;t run the private model
              and you say yes.
            </li>
            <li>
              <strong>Insights</strong>, using your journal entries (and your 1 to 10 ratings), your
              chats, or both, from the last 7 or 30 days that you pick. You can see each item and
              choose which ones to send.
            </li>
            <li>
              <strong>Small steps</strong>, a four-week plan, only if you pick the Cloud way. Your
              journal entries, chats and About me notes from the last 7 or 30 days go out once, to
              get a short summary and a few questions. The plan itself is written from that summary
              (it holds no names) and your answers, so your notes aren&apos;t sent a second time.
              The Private way writes everything on your device and sends nothing. The plan is saved
              only on this device, and you can delete it any time.
            </li>
            <li>
              <strong>The message drafter</strong>, using what you type into it.
            </li>
          </ul>
          <p className="mt-2 text-muted">
            Each time, Haven first finds personal details (names, places, schools, workplaces,
            emails, phone numbers, links) and replaces them with placeholders like [PERSON_1]. You
            see a side-by-side preview, can hide or show anything, and nothing is sent until you
            press Send. The cloud only receives the masked text, and the reply is un-masked here, on
            your device.
          </p>
        </div>

        <div className="rounded-xl bg-surface p-5">
          <h4 className="text-lg font-medium">Who processes cloud requests</h4>
          <p className="mt-2 text-muted">
            Cloud requests go through Google&apos;s Firebase AI Logic to a Gemini model, so Google
            processes the masked text under its terms. Haven keeps no copy. Detection isn&apos;t
            perfect, which is why you review the preview. The app also fetches a small settings file
            (hotline list and a cloud on/off switch) from Firebase Remote Config; it contains no
            data about you.
          </p>
        </div>
      </section>

      <section aria-labelledby="data-h" className="mt-8">
        <h3 id="data-h" className="text-xl font-semibold">
          Your data
        </h3>
        <p className="mt-1 text-muted" role="status">
          {counts
            ? `Stored here: ${counts.messages} messages, ${counts.summaries} summaries, ${counts.notes} notes, ${counts.journal} journal entries.`
            : "Checking what's stored…"}
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" onClick={onDownload}>
            Download my data
          </Button>
          <label className="cursor-pointer rounded-lg border border-line px-6 py-3 font-medium focus-within:outline focus-within:outline-2">
            Restore from file
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          <Button variant="secondary" type="button" onClick={onClearCache}>
            Clear app cache
          </Button>
          <Button variant="dangerOutline" type="button" onClick={() => setConfirmDelete(true)}>
            Delete everything
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted">
          <strong>Clear app cache</strong> removes temporary data the app keeps for speed (browser
          caches, session data and Firebase&apos;s cached settings) and reloads the page. Your
          chats, journal, notes and settings are kept. <strong>Delete everything</strong> erases
          those too. The on-device AI model belongs to Chrome; manage it at
          chrome://on-device-internals.
        </p>

        {msg && (
          <p
            role={msg.kind === "error" ? "alert" : "status"}
            className={`mt-4 rounded-xl p-4 ${msg.kind === "error" ? "bg-danger-bg text-danger-ink" : "bg-accent-soft"}`}
          >
            {msg.text}
          </p>
        )}
      </section>

      {pending && (
        <ConfirmDialog
          title="Replace your data with this backup?"
          confirmLabel="Restore"
          onConfirm={doRestore}
          onCancel={() => setPending(null)}
        >
          <p>
            This backup has {pending.messages.length} messages, {pending.summaries.length}{" "}
            summaries,
            {pending.journal.length} journal entries and {pending.profile.facts.length} notes
            {pending.exportedAt
              ? ` (saved ${new Date(pending.exportedAt).toLocaleDateString()})`
              : ""}
            . Restoring replaces what&apos;s on this device now.
          </p>
        </ConfirmDialog>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete everything?"
          confirmLabel="Delete everything"
          danger
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        >
          <p>
            This permanently erases all chats, summaries, journal entries, notes and settings from
            this device. It can&apos;t be undone. Download a backup first if you might want them
            back.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
