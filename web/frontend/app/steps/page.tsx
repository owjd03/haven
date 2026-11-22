"use client";

import ChoiceBar from "@/app/insights/ChoiceBar";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useCrisis } from "@/components/CrisisProvider";
import { useAI } from "@/components/AIProvider";
import Loading from "@/components/Loading";
import { useShield } from "@/components/ShieldProvider";
import { Button, PageTitle, Textarea, cx } from "@/components/ui";
import { isLocalAvailable, localGenerate, localGenerateStream, toHavenError } from "@/lib/ai";
import { cleanReply } from "@/lib/format";
import { showsLowMoodNote } from "@/lib/insights";
import { isCrisisText } from "@/lib/journal";
import type { PlanMode, PlanWeek, SavedPlan } from "@/lib/plan";
import {
  PRIVATE_MAX_WORDS,
  StoppedError,
  understand,
  writePlan,
  type Generate,
} from "@/lib/privateSteps";
import {
  answersBlock,
  answersHaveCrisis,
  buildAnswersText,
  PLAN_MAX_WORDS,
  gatherSteps,
  parseStageOne,
  planInstruction,
  questionsFor,
  questionsInstruction,
  type GatheredSteps,
} from "@/lib/smallSteps";
import {
  deletePlan,
  getPlan,
  getProfile,
  getStepsChoices,
  savePlan,
  savePlanWeeks,
  saveStepsChoices,
  type StepsChoices,
} from "@/lib/storage";
import { matchPlanIdeas, readingForIdeas } from "@haven/backend";
import { useEffect, useRef, useState } from "react";
import PlanView, { WeekBlock } from "./PlanView";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One job for the small model on this device. Streams when the caller wants the words as they arrive. */
const generate: Generate = (prompt, onPartial) =>
  (onPartial ? localGenerateStream(prompt, onPartial) : localGenerate(prompt)).then((r) => r.text);

const MODES: Array<{ mode: PlanMode; name: string; text: string }> = [
  {
    mode: "private",
    name: "Private",
    text: "Written on your device. Nothing leaves your computer. Simpler plans.",
  },
  {
    mode: "cloud",
    name: "Cloud",
    text: "Written by the cloud model, with a preview first. More detailed plans.",
  },
];

export default function StepsPage() {
  const { runShielded } = useShield();
  const { triggerCrisis } = useCrisis();
  const { phase, progress, localStatus, configured, start, markSource } = useAI();
  const [choices, setChoices] = useState<StepsChoices>({
    days: 7,
    journal: true,
    chats: true,
    aboutMe: true,
    mode: "private",
  });
  const [ready, setReady] = useState(false);
  const [plan, setPlan] = useState<SavedPlan | null>(null);
  const [gathered, setGathered] = useState<GatheredSteps | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  // Stage 1 is "start". Stage 2 shows the questions. While the plan is being written, `partial` holds
  // the text so far. None of this is saved: only the finished plan is.
  const [stage, setStage] = useState<"start" | "answers">("start");
  const [summary, setSummary] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  // `partial` is the text of the plan (cloud) or of the week (private) being written. `doneWeeks` is only
  // set while a private plan is being written. `label` is the loading line. `runMode` is the way chosen
  // when the person pressed Get started, so it can't change half-way.
  const [partial, setPartial] = useState<string | null>(null);
  const [doneWeeks, setDoneWeeks] = useState<PlanWeek[] | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [runMode, setRunMode] = useState<PlanMode>("private");
  // Set when the person leaves the page or starts over, so a private chain stops between jobs.
  const stopRef = useRef(false);
  useEffect(
    () => () => {
      stopRef.current = true;
    },
    [],
  );
  const cantPrivate = localStatus === "unavailable" || !configured;
  const mode: PlanMode = cantPrivate ? "cloud" : choices.mode;

  // The choices and the saved plan live in localStorage, which only exists in the browser.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoices(getStepsChoices());
    setPlan(getPlan());
    setReady(true);
  }, []);

  // Everything here is worked out on the device. Nothing is sent until the person confirms the preview.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGathered(undefined);
    gatherSteps(
      choices.days,
      choices,
      getProfile().facts.map((f) => f.text),
      Date.now(),
      mode === "private" ? PRIVATE_MAX_WORDS : PLAN_MAX_WORDS,
    ).then(
      (g) => alive && setGathered(g),
      () => alive && setGathered(undefined),
    );
    return () => {
      alive = false;
    };
  }, [ready, choices, mode]);

  function change(next: StepsChoices) {
    setChoices(next);
    saveStepsChoices(next);
    setNote(null);
    setError(null);
  }

  const hasText = !!gathered && gathered.text !== "";

  function openQuestions(sum: string, qs: string[]) {
    setSummary(sum);
    setQuestions(qs);
    setAnswers(qs.map(() => ""));
    setStage("answers");
  }

  function startOver() {
    stopRef.current = true;
    setStage("start");
    setQuestions([]);
    setAnswers([]);
    setSummary("");
    setNote(null);
    setError(null);
  }

  /** Stage 1: the cloud reads the notes (after the preview) and writes a summary and questions. */
  async function begin() {
    if (!gathered) return;
    setError(null);
    setNote(null);
    // Nothing to read: no cloud request is needed to ask a few plain questions.
    if (!hasText) {
      openQuestions("", questionsFor(null));
      return;
    }
    setRunMode(mode);
    if (mode === "private") return beginPrivate(gathered.text);
    setBusy(true);
    setLabel("Waiting for the cloud…");
    try {
      const r = await runShielded({
        text: gathered.text,
        instruction: questionsInstruction(choices),
        title: "Review what the cloud will see to get to know you",
      });
      if (!r) setNote("Okay, nothing was sent.");
      else {
        const parsed = parseStageOne(r.text);
        openQuestions(parsed?.summary ?? "", questionsFor(parsed));
        if (r.altered)
          setNote(
            "Some private details in the reply couldn't be restored, so they were left generic.",
          );
      }
    } catch (e) {
      setError(toHavenError(e).message);
    } finally {
      setBusy(false);
      setLabel(null);
    }
  }

  /** Stage 1, private: small jobs on this device read the notes slice by slice, then write the questions. */
  async function beginPrivate(notes: string) {
    stopRef.current = false;
    setBusy(true);
    setLabel("Getting the private model ready…");
    try {
      // Starting the model has to come from the click that got us here.
      if (!(await isLocalAvailable())) {
        await start();
        if (!(await isLocalAvailable())) {
          setError("The private model couldn't start. You can try again, or choose Cloud.");
          return;
        }
      }
      const r = await understand(notes, generate, {
        onProgress: setLabel,
        shouldStop: () => stopRef.current,
      });
      markSource("device");
      openQuestions(r.summary, r.questionList);
    } catch (e) {
      if (!(e instanceof StoppedError)) setError(toHavenError(e).message);
    } finally {
      setBusy(false);
      setLabel(null);
    }
  }

  /** Stage 3, private: one small job per week, each shown as soon as it is written. */
  async function makePrivate(matchText: string, qa: Array<{ question: string; answer: string }>) {
    stopRef.current = false;
    setBusy(true);
    setError(null);
    setNote(null);
    setDoneWeeks([]);
    setPartial("");
    try {
      const run = await writePlan(
        { summary, answersText: answersBlock(qa), matchText },
        generate,
        {
          onPartial: (_n, t) => setPartial(cleanReply(t)),
          onWeek: (w) => {
            setDoneWeeks((prev) => [...(prev ?? []), w]);
            setPartial("");
          },
        },
        { onProgress: setLabel, shouldStop: () => stopRef.current },
      );
      markSource("device");
      setPlan(
        savePlanWeeks(run.weeks, run.closing, {
          days: choices.days,
          sources: { journal: choices.journal, chats: choices.chats, aboutMe: choices.aboutMe },
          lowMood: choices.journal && !!gathered && showsLowMoodNote(gathered.gathered),
          basedOn: run.ideas.map((i) => i.source.name),
          reading: readingForIdeas(run.ideas).map((l) => l.id),
          mode: "private",
        }),
      );
      startOver();
    } catch (e) {
      if (!(e instanceof StoppedError)) setError(toHavenError(e).message);
    } finally {
      setPartial(null);
      setDoneWeeks(null);
      setLabel(null);
      setBusy(false);
    }
  }

  /** Stage 3: the summary and the answers go to the cloud, and the plan is written as it streams in. */
  async function make() {
    const qa = questions.map((question, i) => ({ question, answer: answers[i] ?? "" }));
    // Same safety rule as chat: crisis language is never sent. The words are cleared, and support is shown.
    if (answersHaveCrisis(qa)) {
      setAnswers((prev) => prev.map((a) => (isCrisisText(a) ? "" : a)));
      triggerCrisis();
      return;
    }
    const matchText = [gathered?.text ?? "", summary, ...qa.map((x) => x.answer)].join("\n");
    if (runMode === "private") return makePrivate(matchText, qa);
    const ideas = matchPlanIdeas(matchText, 8);
    setBusy(true);
    setError(null);
    setNote(null);
    setLabel("Waiting for the cloud…");
    try {
      const r = await runShielded({
        text: buildAnswersText(summary, qa),
        instruction: planInstruction(matchText, ideas),
        title: "Review what the cloud will see for your plan",
        onPartial: setPartial,
      });
      if (!r) setNote("Okay, nothing was sent.");
      else {
        setPlan(
          savePlan(cleanReply(r.text), {
            days: choices.days,
            sources: { journal: choices.journal, chats: choices.chats, aboutMe: choices.aboutMe },
            lowMood: choices.journal && !!gathered && showsLowMoodNote(gathered.gathered),
            basedOn: ideas.map((i) => i.source.name),
            reading: readingForIdeas(ideas).map((l) => l.id),
            mode: "cloud",
          }),
        );
        startOver();
        if (r.altered)
          setNote(
            "Some private details in the reply couldn't be restored, so they were left generic.",
          );
      }
    } catch (e) {
      setError(toHavenError(e).message);
    } finally {
      setPartial(null);
      setLabel(null);
      setBusy(false);
    }
  }

  function status(g: GatheredSteps): string {
    if (g.text === "")
      return g.gathered.excluded > 0
        ? "Nothing can be sent for this time range. Haven can still ask you a few questions."
        : "No notes in this time range yet. Haven can still ask you a few questions.";
    const parts: string[] = [];
    if (g.gathered.journalEntries > 0)
      parts.push(plural(g.gathered.journalEntries, "journal entry", "journal entries"));
    if (g.gathered.chatDays > 0)
      parts.push(`${plural(g.gathered.chatDays, "day", "days")} of chats`);
    if (g.aboutMe > 0) parts.push(plural(g.aboutMe, "About me note", "About me notes"));
    return `Ready: ${parts.join(", ")} from the last ${choices.days} days.`;
  }

  const writing = partial !== null || doneWeeks !== null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-6">
      <header className="flex flex-col items-center text-center">
        <PageTitle where={mode === "private" ? "private" : "cloud"} centered>
          Small steps
        </PageTitle>
        <p className="mt-2 text-muted">
          Haven reads what you&apos;ve shared, asks a few questions, then builds a plan of
          longer-term things to try over four weeks.{" "}
          {mode === "private"
            ? "Everything is written on this device, and nothing is sent anywhere."
            : "Nothing leaves this device until you press Send."}
        </p>
        {stage === "start" && !writing && <ChoiceBar choices={choices} onChange={change} />}
      </header>

      {stage === "start" && !writing && (
        <div className="mt-6 flex flex-col items-center text-center">
          <p className="text-sm text-muted" role="status">
            {gathered === undefined ? "Looking at your notes…" : status(gathered)}
          </p>
          {gathered && gathered.gathered.excluded > 0 && (
            <p className="mt-1 text-sm text-muted">
              {plural(gathered.gathered.excluded, "journal entry was", "journal entries were")} left
              out and {gathered.gathered.excluded === 1 ? "is" : "are"} never sent to any AI.
            </p>
          )}
          <fieldset className="mt-5 w-full max-w-xl" disabled={busy}>
            <legend className="sr-only">How should the plan be written?</legend>
            <div className="grid gap-3 text-left sm:grid-cols-2">
              {MODES.map((o) => {
                const off = o.mode === "private" && cantPrivate;
                const selected = mode === o.mode;
                return (
                  <label
                    key={o.mode}
                    className={cx(
                      "rounded-xl border-2 p-4 has-focus-visible:outline-3 has-focus-visible:outline-accent",
                      selected ? "border-ink" : "border-line",
                      off ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                    )}
                  >
                    <input
                      type="radio"
                      name="plan-mode"
                      className="sr-only"
                      checked={selected}
                      disabled={off}
                      onChange={() => change({ ...choices, mode: o.mode })}
                    />
                    <span className="block font-medium">{o.name}</span>
                    <span className="mt-1 block text-sm text-muted">{o.text}</span>
                  </label>
                );
              })}
            </div>
            {cantPrivate && (
              <p className="mt-2 text-sm text-muted">
                The private way needs desktop Chrome with the private model, which this browser
                can&apos;t run, so Cloud is selected.
              </p>
            )}
          </fieldset>
          <Button
            size="lg"
            className="mt-4"
            onClick={begin}
            disabled={busy || gathered === undefined}
          >
            {busy ? "Working…" : plan ? "Make a new plan" : "Get started"}
          </Button>
          <p className="mt-2 max-w-md text-xs text-muted">
            {mode === "private"
              ? "First Haven reads what you've shared, on this device, and asks a few questions. Nothing leaves your computer."
              : "First Haven reads what you've shared and asks a few questions. Names and places are hidden first, and you'll review exactly what would be sent before anything leaves this device."}
          </p>
        </div>
      )}

      {stage === "answers" && !writing && (
        <section aria-labelledby="questions-h" className="mt-8">
          <h2 id="questions-h" className="text-center text-xl">
            A few questions
          </h2>
          <p className="mt-1 text-center text-sm text-muted">
            Answer what you like and skip the rest. Your answers shape the plan.
          </p>
          <div className="mt-5 space-y-5">
            {questions.map((q, i) => (
              <div key={i}>
                <label htmlFor={`q-${i}`} className="block font-medium">
                  {q}
                </label>
                <Textarea
                  id={`q-${i}`}
                  tone="bg"
                  radius="xl"
                  rows={2}
                  className="mt-1 w-full border-2! border-ink/25! focus:border-accent!"
                  value={answers[i] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => prev.map((a, k) => (k === i ? e.target.value : a)))
                  }
                />
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-col items-center gap-3">
            <Button size="lg" onClick={make} disabled={busy}>
              {busy ? "Working…" : "Make my plan"}
            </Button>
            <button
              type="button"
              onClick={startOver}
              disabled={busy}
              className="rounded px-2 py-2 text-sm text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-accent disabled:opacity-60"
            >
              Start over
            </button>
          </div>
        </section>
      )}

      {busy && !writing && label && (
        <Loading
          label={
            phase === "loading"
              ? "Getting the private model ready. The first time can take a few minutes."
              : label
          }
          progress={phase === "loading" ? progress : undefined}
          className="mx-auto mt-6 max-w-md"
        />
      )}

      {writing && (
        <section aria-label="Your plan, being written" aria-busy="true" className="mt-8">
          <article className="rounded-xl border border-line bg-surface p-5">
            {doneWeeks && doneWeeks.length > 0 && (
              <div className="space-y-6">
                {doneWeeks.map((w) => (
                  <WeekBlock key={w.n} w={w} />
                ))}
              </div>
            )}
            {partial && (
              <p
                className={cx(
                  "leading-relaxed whitespace-pre-wrap text-muted",
                  doneWeeks && doneWeeks.length > 0 && "mt-6",
                )}
              >
                {partial}
              </p>
            )}
            <Loading
              label={runMode === "private" ? (label ?? "Writing your plan…") : "Writing your plan…"}
              className={partial || (doneWeeks && doneWeeks.length > 0) ? "mt-5" : ""}
            />
          </article>
        </section>
      )}

      {error && (
        <p role="alert" className="mt-6 rounded-xl bg-danger-bg p-4 text-danger-ink">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="mt-6 rounded-xl bg-accent-soft p-4">
          {note}
        </p>
      )}

      {plan && stage === "start" && !writing && (
        <PlanView plan={plan} onDelete={() => setAskDelete(true)} />
      )}

      {askDelete && (
        <ConfirmDialog
          title="Delete your plan?"
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deletePlan();
            setPlan(null);
            setAskDelete(false);
          }}
          onCancel={() => setAskDelete(false)}
        >
          <p>
            This removes it from this device. If you made a backup file, the plan stays in that
            file.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
