/**
 * Small steps, the private way: the whole thing is written by the small model on this device, as a
 * chain of short jobs run one after another. Nothing here touches the network. The model is passed
 * in (`generate`), so this file has no browser or model code of its own and can be tested alone.
 */
import { matchPlanIdeas, type PlanIdea } from "@haven/backend";
import { cleanReply } from "./format";
import { parseSingleWeek, plainWeek, type PlanWeek } from "./plan";
import { countWords } from "./promptBuilder";
import { parseStageOne, questionsFor, type StageOne } from "./smallSteps";

/** Notes read in the private way (the cloud way reads up to 3,000). The small model's memory is short. */
export const PRIVATE_MAX_WORDS = 1500;
/** About how many words each slice-summarising job reads. */
export const SLICE_WORDS = 400;

/** One on-device job. `onPartial` receives the text so far, for jobs that show as they are written. */
export type Generate = (prompt: string, onPartial?: (textSoFar: string) => void) => Promise<string>;

export interface Hooks {
  /** A plain line for the loading display, e.g. "Writing week 2 of 4…". */
  onProgress?: (label: string) => void;
  /** Return true to stop between jobs (the person left or started over). */
  shouldStop?: () => boolean;
}

/** Thrown when `shouldStop` says so. The page treats it as "never mind", not as an error. */
export class StoppedError extends Error {
  constructor() {
    super("stopped");
    this.name = "StoppedError";
  }
}

function check(h: Hooks) {
  if (h.shouldStop?.()) throw new StoppedError();
}

/** Always used as the plan's closing line in the private way: safety wording shouldn't depend on a small model. */
export const PRIVATE_CLOSING =
  "If after a couple of weeks things feel the same or heavier, it is worth talking to a counselor or doctor.";

// ---------- slicing ----------

/**
 * Cuts the gathered notes into slices of about `max` words, on line breaks where possible so a note
 * isn't split. A single line longer than `max` is cut by words. Nothing is dropped, and the order is kept.
 */
export function sliceNotes(text: string, max = SLICE_WORDS): string[] {
  const pieces: string[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const words = line.trim().split(/\s+/);
    if (words.length <= max) pieces.push(line.trim());
    else for (let i = 0; i < words.length; i += max) pieces.push(words.slice(i, i + max).join(" "));
  }
  const slices: string[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const p of pieces) {
    const w = countWords(p);
    if (cur.length && n + w > max) {
      slices.push(cur.join("\n"));
      cur = [];
      n = 0;
    }
    cur.push(p);
    n += w;
  }
  if (cur.length) slices.push(cur.join("\n"));
  return slices;
}

// ---------- the instructions ----------

const PLAIN = "Plain text only, with no bold, no headings and no lists unless asked.";

export function sliceInstruction(slice: string): string {
  return (
    "You are Haven, a gentle companion (not a therapist). Below are some notes a person wrote. Journal lines may include their own rating of how they felt, from 1 (really low) to 10 (really good); it is their own number, so never read it clinically. " +
    "In two or three plain sentences, in the third person and without any names or places, say what seems to be going on for them, what hurts and what seems to help. No advice, no diagnosis. " +
    PLAIN +
    "\n\nNotes:\n" +
    slice
  );
}

export function combineInstruction(parts: string[]): string {
  return (
    "You are Haven, a gentle companion (not a therapist). Below are short summaries of different parts of a person's notes. " +
    "Join them into one summary of two to four sentences, in the third person, without any names or places: what seems to be going on for them, what hurts and what seems to help. No advice, no diagnosis. " +
    PLAIN +
    "\n\nSummaries:\n" +
    parts.map((p, i) => `${i + 1}. ${p}`).join("\n")
  );
}

export function questionsFromSummaryInstruction(summary: string): string {
  return (
    "You are Haven, a gentle companion (not a therapist). Below is a short summary of a person's situation. " +
    "To help them build a longer-term plan to feel better, write 3 to 5 numbered questions (1., 2., 3.) about what they enjoy or have enjoyed, what and who helps, what they would like more of, and what is realistic for them right now. " +
    'Start with the word "Questions:". Each question is one kind, open sentence. Never ask about the details of what hurt them, never ask for names or places, and never ask anything clinical. ' +
    PLAIN +
    "\n\nSummary:\n" +
    (summary.trim() || "(nothing known yet)")
  );
}

const WEEK_FOCUS = [
  "Start gently, with small things that are easy to begin.",
  "Build on week 1 a little, and add one thing to do with other people if that fits them.",
  "Go a little deeper into what seems to suit them, and mix things with others and things alone.",
  "Bring it together: keep what has worked and plan how to carry on after the four weeks.",
];

/** Library ideas for one week: a different overlapping handful each time, so the weeks differ. */
export function ideasForWeek(ideas: PlanIdea[], n: number): PlanIdea[] {
  if (ideas.length <= 3) return ideas;
  const start = ((n - 1) * 2) % ideas.length;
  return [0, 1, 2].map((k) => ideas[(start + k) % ideas.length]);
}

export function weekInstruction(opts: {
  n: number;
  summary: string;
  answersText: string;
  ideas: PlanIdea[];
  earlierThemes: string[];
}): string {
  const { n, summary, answersText, ideas, earlierThemes } = opts;
  const base =
    "You are Haven, a gentle companion (not a therapist). Below is what is known about a person and their answers to some questions. " +
    `Write week ${n} of a four-week plan: two longer-term, concrete activities that could help them feel better over time. These are not quick tips for today. ` +
    "Use exactly this plain-text format and nothing else:\n" +
    `Week ${n}: <a short theme for the week>\n` +
    "- <Activity name>: <what it is, in one sentence>. Why: <one sentence, tied to what they shared>. First step: <one concrete first step>. How often: <a short phrase, like once a week>.\n" +
    "- <second activity in the same shape>\n" +
    WEEK_FOCUS[Math.min(Math.max(n, 1), 4) - 1] +
    " Fit the time they said they have. " +
    "Never suggest anything connected to the person, place or situation that is hurting them, or to anything they said they would rather avoid. If they used to do something with a particular person, do not suggest it. " +
    "Use everyday life only: people, movement, interests, routines, learning, time outside, helping others, rest. Be specific (a kind of class, group, place or routine). " +
    "Never diagnose, never give medical advice, and never mention medication, therapy or treatment. Don't set goals or targets, and don't mention streaks, tracking or reminders. Speak to them as 'you'. " +
    PLAIN +
    (earlierThemes.length
      ? `\nThe earlier weeks were about: ${earlierThemes.map((t, i) => `week ${i + 1}, ${t || "a gentle start"}`).join("; ")}. Do not repeat those activities.`
      : "");
  const library = ideas.length
    ? "\nIdeas from general wellbeing guidance you may draw on. Adapt them to this person, and skip any that don't fit:\n" +
      ideas.map((i) => `- ${i.title}: ${i.idea} (${i.source.name})`).join("\n")
    : "";
  return `${base}${library}\n\nWhat is known about them:\n${summary.trim() || "(nothing yet)"}\n\n${answersText}`;
}

// ---------- the chains ----------

/** Runs `go` up to twice. Returns the first good text, or null (with the last error, if any). */
async function twice(
  go: () => Promise<string>,
  good: (t: string) => boolean,
  h: Hooks,
): Promise<{ text: string | null; error: unknown }> {
  let error: unknown = null;
  for (let i = 0; i < 2; i++) {
    check(h);
    try {
      const t = cleanReply(await go());
      if (good(t)) return { text: t, error };
    } catch (e) {
      if (e instanceof StoppedError) throw e;
      error = e;
    }
  }
  return { text: null, error };
}

const nonEmpty = (t: string) => t.trim().length > 3;

/**
 * Stage 1: summarise each slice of the notes, join the summaries, then write the questions.
 * A slice that fails twice is skipped; if every slice fails, the last error is thrown. With no notes
 * it makes no model call at all.
 */
export async function understand(
  notes: string,
  generate: Generate,
  hooks: Hooks = {},
): Promise<StageOne & { questionList: string[] }> {
  const slices = sliceNotes(notes);
  if (slices.length === 0) return { summary: "", questions: [], questionList: questionsFor(null) };
  const parts: string[] = [];
  let lastError: unknown = null;
  for (let i = 0; i < slices.length; i++) {
    hooks.onProgress?.(
      slices.length > 1
        ? `Reading your notes… (${i + 1} of ${slices.length})`
        : "Reading your notes…",
    );
    const r = await twice(() => generate(sliceInstruction(slices[i])), nonEmpty, hooks);
    if (r.text) parts.push(r.text);
    else lastError = r.error ?? lastError;
  }
  if (parts.length === 0) throw lastError ?? new Error("No summary could be written.");
  let summary = parts[0];
  if (parts.length > 1) {
    hooks.onProgress?.("Putting it together…");
    const c = await twice(() => generate(combineInstruction(parts)), nonEmpty, hooks);
    summary = c.text ?? parts.join(" ");
  }
  hooks.onProgress?.("Thinking of questions…");
  const q = await twice(
    () => generate(questionsFromSummaryInstruction(summary)),
    (t) => (parseStageOne(t)?.questions.length ?? 0) >= 2,
    hooks,
  );
  const parsed = q.text ? parseStageOne(q.text) : null;
  const own = parsed && parsed.questions.length >= 2 ? parsed.questions : [];
  return {
    summary: summary.slice(0, 700),
    questions: own,
    questionList: questionsFor({ summary, questions: own }),
  };
}

export interface PlanRun {
  weeks: PlanWeek[];
  closing: string;
  ideas: PlanIdea[];
}

/**
 * Stage 3: one job per week, one after another. Each sees the themes of the weeks before it. A week
 * that can't be read as activities (after one retry) is kept as plain text; one with no words at all
 * is left out. Fewer than two weeks is an error.
 */
export async function writePlan(
  input: { summary: string; answersText: string; matchText: string; ideas?: PlanIdea[] },
  generate: Generate,
  handlers: {
    /** The week being written, as it arrives. */
    onPartial?: (n: number, textSoFar: string) => void;
    /** A finished week. */
    onWeek?: (week: PlanWeek) => void;
  } = {},
  hooks: Hooks = {},
): Promise<PlanRun> {
  const ideas = input.ideas ?? matchPlanIdeas(input.matchText, 8);
  const weeks: PlanWeek[] = [];
  let lastError: unknown = null;
  for (let n = 1; n <= 4; n++) {
    hooks.onProgress?.(`Writing week ${n} of 4…`);
    let raw = "";
    const r = await twice(
      () =>
        generate(
          weekInstruction({
            n,
            summary: input.summary,
            answersText: input.answersText,
            ideas: ideasForWeek(ideas, n),
            earlierThemes: weeks.map((w) => w.theme),
          }),
          (t) => handlers.onPartial?.(n, t),
        ).then((t) => (raw = t)),
      (t) => parseSingleWeek(t, n) !== null,
      hooks,
    );
    const week = (r.text && parseSingleWeek(r.text, n)) || plainWeek(n, cleanReply(raw));
    if (week) {
      weeks.push(week);
      handlers.onWeek?.(week);
    } else lastError = r.error ?? lastError;
  }
  if (weeks.length < 2) throw lastError ?? new Error("The plan could not be written.");
  return { weeks, closing: PRIVATE_CLOSING, ideas };
}
