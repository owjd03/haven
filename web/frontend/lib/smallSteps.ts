"use client";

/**
 * Small steps (cloud, asks first): a 4-week plan of longer-term activities, built in three stages.
 * 1. Understand: the person's notes (after the shield preview) go to the cloud model, which writes a
 *    short summary of the situation and a few questions.
 * 2. Answers: the person answers the questions, all optional.
 * 3. Plan: the summary and the answers go to the cloud, which writes the plan, grounded in a researched
 *    library of plan ideas that is matched here, on the device.
 * Everything in this file runs on the device. Text only leaves after the person reviews the privacy
 * shield preview and presses Send.
 */
import { matchPlanIdeas, type PlanIdea } from "@haven/backend";
import {
  buildInsights,
  loadInsightInput,
  type GatheredInsights,
  type InsightInput,
  type ItemLimits,
} from "./insights";
import { isCrisisText } from "./journal";
import type { PlanSources } from "./plan";
import { countWords, trimWords } from "./promptBuilder";

/** Words of the person's notes that go out in the first request. */
export const PLAN_MAX_WORDS = 3000;
/** How many of those are About me notes. */
export const ABOUT_ME_MAX_WORDS = 200;
/** How much of each note, summary or message is kept (more than Insights, since a plan wants context). */
export const PLAN_LIMITS: ItemLimits = { entry: 250, summary: 150, message: 100 };

export interface GatheredSteps {
  /** The text for the shield preview. Empty if there is nothing to send. */
  text: string;
  /** What the journal and chats part found (counts, left-out entries, ratings). */
  gathered: GatheredInsights;
  /** How many About me notes are in the text. */
  aboutMe: number;
}

/**
 * Pure part: About me notes first (within their word limit, and never one that reads as crisis
 * language), then the same gathering as Insights with the rest of the budget.
 */
export function buildSteps(
  input: Omit<InsightInput, "sources">,
  facts: string[],
  sources: PlanSources,
  maxWords = PLAN_MAX_WORDS,
): GatheredSteps {
  const kept: string[] = [];
  let words = 0;
  if (sources.aboutMe) {
    for (const f of facts) {
      const line = trimWords(f, 60);
      if (!line.trim() || isCrisisText(f)) continue;
      const w = countWords(line);
      if (words + w > ABOUT_ME_MAX_WORDS) break;
      kept.push(line);
      words += w;
    }
  }
  const gathered = buildInsights(
    { ...input, sources: { journal: sources.journal, chats: sources.chats } },
    undefined,
    maxWords - words,
    PLAN_LIMITS,
  );
  const about = kept.length
    ? "About me (what they have said about their life):\n" + kept.map((f) => `- ${f}`).join("\n")
    : "";
  return {
    text: [about, gathered.text].filter(Boolean).join("\n\n"),
    gathered,
    aboutMe: kept.length,
  };
}

/** Loads the chosen range from this device and gathers it. */
export async function gatherSteps(
  rangeDays: number,
  sources: PlanSources,
  facts: string[],
  now = Date.now(),
  maxWords = PLAN_MAX_WORDS,
): Promise<GatheredSteps> {
  const input = await loadInsightInput(
    rangeDays,
    { journal: sources.journal, chats: sources.chats },
    now,
  );
  return buildSteps(input, facts, sources, maxWords);
}

function sourcePhrase(s: PlanSources): string {
  const parts = [
    s.journal && "their journal",
    s.chats && "their chats with Haven",
    s.aboutMe && "things they wrote about their life (About me)",
  ].filter(Boolean) as string[];
  return parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
    : parts[0];
}

// ---------- stage 1: understand ----------

/** Always asked, whatever the cloud model writes. The first is what stops a plan from reaching for a shared past. */
export const FIXED_QUESTIONS = [
  "Is there anything you'd rather not do, or not be reminded of?",
  "How much time could you give this in a normal week?",
];

/** Used when there are no notes to read, or the cloud model's questions couldn't be understood. */
export const GENERIC_QUESTIONS = [
  "What has been going on for you lately?",
  "What did you enjoy doing before things got hard?",
  "Who are the people who make things feel a little better?",
];

/**
 * The first request. The reply is a short summary (kept for stage 3, so the notes need not be sent
 * again) and 3 to 5 questions. It never contains the person's words in the instruction itself.
 */
export function questionsInstruction(sources: PlanSources): string {
  return (
    `You are Haven, a gentle companion (not a therapist). Below are notes from ${sourcePhrase(sources)}, oldest first. ` +
    (sources.journal
      ? "Journal lines include the person's own rating of how they felt, from 1 (really low) to 10 (really good). The rating is their own number, not a measurement; never interpret it clinically. "
      : "") +
    "Your job is to get to know them well enough to help them build a longer-term plan to feel better. " +
    'Reply in exactly this plain-text shape. First the word "Summary:" and two to four sentences, in the third person and without any names or places, saying what seems to be going on for them, what hurts and what seems to help. ' +
    'Then the word "Questions:" and 3 to 5 numbered questions (1., 2., 3.). Ask what you need to know to make a plan that fits them: what they enjoy or have enjoyed, what and who helps, what they would like more of, what is realistic for them right now, and anything else this particular situation calls for. ' +
    "Each question is one kind, open sentence. Never ask about the details of what hurt them, never ask for names or places, and never ask anything clinical. Never diagnose or give medical advice. No headings, no bold, plain text only."
  );
}

export interface StageOne {
  summary: string;
  questions: string[];
}

const NUMBERED = /^(?:[-*•]\s*)?(?:\*\*)?(\d{1,2})[.)]\s*(?:\*\*)?\s*(.+)$/;
const clean = (s: string) =>
  s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** Reads the summary and the numbered questions. Returns null if neither could be found. */
export function parseStageOne(reply: string): StageOne | null {
  const lines = reply.replace(/\r/g, "").split("\n");
  const summaryLines: string[] = [];
  const questions: string[] = [];
  let mode: "none" | "summary" | "questions" = "none";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const label = /^(?:\*\*)?(summary|questions)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*)$/i.exec(line);
    if (label) {
      mode = label[1].toLowerCase() as "summary" | "questions";
      if (label[2]) (mode === "summary" ? summaryLines : questions).push(label[2]);
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (mode === "questions" || (mode === "none" && numbered)) {
      mode = "questions";
      if (numbered) questions.push(numbered[2]);
      else if (questions.length) questions[questions.length - 1] += ` ${line}`;
    } else if (mode === "summary") {
      summaryLines.push(line);
    }
  }
  const qs = questions
    .map(clean)
    .filter((q) => q.length > 3)
    .slice(0, 5);
  const summary = clean(summaryLines.join(" ")).slice(0, 700);
  if (qs.length === 0 && !summary) return null;
  return { summary, questions: qs };
}

/** What the person is asked: the cloud model's questions (or generic ones), then the two fixed ones. */
export function questionsFor(parsed: StageOne | null): string[] {
  const own = parsed && parsed.questions.length >= 2 ? parsed.questions : GENERIC_QUESTIONS;
  return [...own, ...FIXED_QUESTIONS];
}

// ---------- stage 2 and 3: answers and the plan ----------

/** The answered questions as text ("Q: ... A: ..."), or a line saying they chose not to answer. */
export function answersBlock(qa: Array<{ question: string; answer: string }>): string {
  const answered = qa.filter((x) => x.answer.trim());
  return answered.length
    ? "Their answers to some questions:\n" +
        answered.map((x) => `Q: ${x.question}\nA: ${x.answer.trim()}`).join("\n\n")
    : "They chose not to answer the questions.";
}

/** The text that goes out for the plan: the earlier summary (no names) and the answers that were given. */
export function buildAnswersText(
  summary: string,
  qa: Array<{ question: string; answer: string }>,
): string {
  return [
    "What is known about this person (a short summary written earlier, with no names):",
    summary.trim() || "(nothing yet)",
    "",
    answersBlock(qa),
  ].join("\n");
}

/** True if any answer reads as crisis language. Nothing is sent when it does. */
export function answersHaveCrisis(qa: Array<{ answer: string }>): boolean {
  return qa.some((x) => isCrisisText(x.answer));
}

/**
 * The second request: write the 4-week plan. `matchText` is everything read on the device (notes,
 * summary, answers); it is only used to pick matching library ideas, and never sent itself. The
 * instruction holds fixed text and generic library ideas, so it never contains the person's words.
 */
export function planInstruction(
  matchText: string,
  ideas: PlanIdea[] = matchPlanIdeas(matchText, 8),
): string {
  const base =
    "You are Haven, a gentle companion (not a therapist). Below is a short summary of what a person has shared and their answers to some questions. " +
    "Write a plan for the next four weeks: longer-term, concrete activities that could help them feel better over time. These are not quick tips for today. " +
    "Use exactly this plain-text format and no other headings:\n" +
    "Week 1: <a short theme for the week>\n" +
    "- <Activity name>: <what it is, in one sentence>. Why: <one sentence, tied to what they shared>. First step: <one concrete first step>. How often: <a short phrase, like once a week>.\n" +
    "Give 2 or 3 activities for each of weeks 1 to 4. Then finish with one line: \n" +
    "Closing: <one gentle sentence saying that if after a couple of weeks things feel the same or heavier, it is worth talking to a counselor or doctor>\n" +
    "Rules. Build on what they enjoy and said helps, and make the plan fit the time they said they have. Start gently and build up over the weeks, and mix things to do with other people and things to do alone. " +
    "Never suggest anything connected to the person, place or situation that is hurting them, or to anything they said they would rather avoid or not be reminded of. If they used to do something with a particular person, do not suggest it. " +
    "Use everyday life only: people, movement, interests, routines, learning, time outside, helping others, rest. Be specific (a kind of class, group, place or routine), not vague. " +
    "Never diagnose, never label a pattern as a condition, never give medical advice, and never mention medication, therapy techniques or treatment. Don't set goals or targets, and don't mention streaks, tracking or reminders. " +
    "Speak to them directly as 'you'. Plain text only, with no bold and no other formatting.";
  if (ideas.length === 0) return base;
  return (
    base +
    "\nIdeas from general wellbeing guidance you may draw on. Adapt them to this person, and skip any that don't fit them:\n" +
    ideas.map((i) => `- ${i.title}: ${i.idea} (${i.source.name})`).join("\n")
  );
}
