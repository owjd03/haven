/**
 * Builds the single-turn prompt for the on-device model. Gemini Nano has no chat
 * memory, so all context (profile, summary, recent messages, coping cards) is
 * assembled into one text prompt, kept to about MAX_WORDS words.
 *
 * Haven has two reply modes: "listen" (default: reflect and ask, no advice) and "help"
 * (ask what was tried, then offer at most one idea). Coping cards only appear in help mode.
 */
import type { ChatMode } from "@haven/backend";

export const MAX_WORDS = 900;
/** Used when the model reports the prompt is too long: a smaller budget, one retry. */
export const FALLBACK_WORDS = 450;
/** Number of most recent messages sent verbatim. */
export const KEEP_RECENT = 8;
/** How many new messages are folded into the rolling summary each time. */
export const SUMMARY_BATCH = 8;
/** Fold older messages into the rolling summary once this many are unsummarized. */
export const SUMMARY_THRESHOLD = KEEP_RECENT + SUMMARY_BATCH;

const MAX_MESSAGE_WORDS = 80;
const MAX_USER_WORDS = 250;
const MAX_SUMMARY_WORDS = 130;
const MAX_PROFILE_WORDS = 100;

/**
 * Shared by both modes: who Haven is, the safety rules, and the writing rules. Kept short on
 * purpose: the small on-device model follows a few direct rules better than a long paragraph.
 */
export const BASE_INSTRUCTION =
  "You are Haven, a warm companion for students and young adults going through something hard. " +
  "You are not a therapist. Never diagnose, and never give medical advice; if asked for a diagnosis, say you can't and suggest a doctor or counselor. " +
  "Plain text only: no lists, bold, asterisks or emoji. No pet names. Never start with 'Oh'. " +
  "Begin by reflecting something specific they said. Mention their notes or earlier events only if their message is about them, and then bring it up instead of asking again.";

const LISTEN_BODY =
  "They mostly want to be heard. Reply in 2 to 4 sentences. Show you understand how it feels. " +
  "No advice or techniques unless they ask. " +
  "If they mention something risky or harmful, gently name the likely consequences. ";

/** Listen replies alternate: this one ends with a question... */
export const LISTEN_INSTRUCTION = LISTEN_BODY + "End with one caring question.";

/** ...and this one doesn't, so listening never turns into an interview. */
export const LISTEN_INVITE_INSTRUCTION =
  LISTEN_BODY +
  "Do not ask a question this time. End by gently inviting them to say more if they want.";

export const OFFER_IDEAS_INSTRUCTION =
  " Instead of another question about the story, end by asking, in your own words, whether they'd like some ideas or would rather just get it out.";

export const HELP_INSTRUCTION =
  "They want help thinking it through. Reply in 4 to 6 sentences. Acknowledge the feeling briefly. " +
  "If you don't know what they've tried, ask instead of advising. " +
  "Otherwise offer one small, practical idea (a technique below, if it fits). " +
  "If something risky comes up, gently warn about the consequences. " +
  "Suggest a counselor or doctor only if it would truly help. " +
  "End with at most one question.";

export function instructionFor(mode: ChatMode, offerIdeas = false, askQuestion = true): string {
  if (mode === "help") return `${BASE_INSTRUCTION} ${HELP_INSTRUCTION}`;
  if (!askQuestion) return `${BASE_INSTRUCTION} ${LISTEN_INVITE_INSTRUCTION}`;
  return `${BASE_INSTRUCTION} ${LISTEN_INSTRUCTION}${offerIdeas ? OFFER_IDEAS_INSTRUCTION : ""}`;
}

/**
 * One short example per mode. It sets the tone better than more rules. The topic is deliberately
 * unlike real messages, so the model is unlikely to copy its details into a real reply.
 */
export const LISTEN_EXAMPLE =
  "User: I missed my bus and then spilled coffee all over my notes. Everything is going wrong today.\n" +
  "Haven: Missing the bus and then losing your notes to coffee, all before the day has really started, is a rough way to begin. No wonder it feels like everything is going wrong. What's been the hardest part so far?";

export const LISTEN_INVITE_EXAMPLE =
  "User: I missed my bus and then spilled coffee all over my notes. Everything is going wrong today.\n" +
  "Haven: Missing the bus and then losing your notes to coffee, all before the day has really started, is a rough way to begin. No wonder it feels like everything is going wrong. I'm here if you want to tell me more.";

export const HELP_EXAMPLE =
  "User: I keep missing my morning bus even with two alarms. What can I do?\n" +
  "Haven: That sounds frustrating, especially when you're already trying. Since the alarms get you up but not out the door, one small step could be laying out everything you need the night before. Would that fit your mornings?";

export function exampleFor(mode: ChatMode, askQuestion = true): string {
  const example =
    mode === "help" ? HELP_EXAMPLE : askQuestion ? LISTEN_EXAMPLE : LISTEN_INVITE_EXAMPLE;
  return "Example of the style only, not this person:\n" + example;
}

/** Repeated right before the reply: small models weigh the last thing they read the most. */
export function reminderFor(mode: ChatMode, askQuestion = true): string {
  if (mode === "help")
    return "[Remember: 4 to 6 sentences, no pet names, at most one idea, one question.]";
  return askQuestion
    ? "[Remember: 2 to 4 sentences, no pet names, no advice, one question.]"
    : "[Remember: 2 to 4 sentences, no pet names, no advice, no question this time.]";
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PromptCard {
  title: string;
  text: string;
}

export interface PromptInput {
  /** Defaults to "listen". Cards are ignored unless the mode is "help". */
  mode?: ChatMode;
  /** End a Listen reply by asking, once, whether the person wants ideas. */
  offerIdeas?: boolean;
  /** Listen replies alternate: true (the default) ends with a question, false with an invitation. */
  askQuestion?: boolean;
  profileFacts: string[];
  summary?: string;
  /** e.g. "3 days ago", set only after a long gap. */
  lastTalked?: string;
  /** The "Open threads" line of the summary, shown only with lastTalked. */
  openThreads?: string;
  recent: PromptMessage[];
  cards: PromptCard[];
  userMessage: string;
  /** Word budget override (used for the shrink-and-retry). */
  maxWords?: number;
}

export function countWords(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function trimWords(s: string, max: number): string {
  const words = s.trim().split(/\s+/);
  return words.length <= max ? s.trim() : words.slice(0, max).join(" ") + "…";
}

/** The "time has passed" line, shared by the on-device and cloud prompts. */
export function lastTalkedLine(lastTalked?: string, openThreads?: string): string {
  if (!lastTalked) return "";
  return (
    `You last talked ${lastTalked}.` +
    (openThreads ? ` Things that were still open then: ${trimWords(openThreads, 40)}` : "") +
    " If it fits, you can gently ask how one of them turned out. Don't list them."
  );
}

interface Parts {
  instruction: string;
  example: string;
  reminder: string;
  facts: string[];
  summary: string;
  gap: string;
  cards: PromptCard[];
  recent: PromptMessage[];
  user: string;
}

function assemble(p: Parts): string {
  const blocks: string[] = [p.instruction];
  if (p.example) blocks.push(p.example);
  if (p.facts.length) {
    blocks.push(
      "What the user has shared about their life:\n" + p.facts.map((f) => `- ${f}`).join("\n"),
    );
  }
  if (p.summary) blocks.push("Earlier conversation (summary):\n" + p.summary);
  if (p.gap) blocks.push(p.gap);
  if (p.cards.length) {
    blocks.push(
      "A gentle technique you may offer if it fits (don't force it):\n" +
        p.cards.map((c) => `- ${c.title}: ${c.text}`).join("\n"),
    );
  }
  if (p.recent.length) {
    blocks.push(
      "Recent messages:\n" +
        p.recent.map((m) => `${m.role === "user" ? "User" : "Haven"}: ${m.content}`).join("\n"),
    );
  }
  blocks.push(`User: ${p.user}\n${p.reminder}\nHaven:`);
  return blocks.join("\n\n");
}

export function buildPrompt(input: PromptInput): string {
  const mode: ChatMode = input.mode ?? "listen";
  const budget = input.maxWords ?? MAX_WORDS;
  const ask = input.askQuestion ?? true;

  // Cap the profile section so a long list of facts can't crowd out the conversation.
  const facts: string[] = [];
  let used = 0;
  for (const f of input.profileFacts) {
    const w = countWords(f);
    if (used + w > MAX_PROFILE_WORDS) break;
    facts.push(f.trim());
    used += w;
  }

  const parts: Parts = {
    instruction: instructionFor(mode, input.offerIdeas, ask),
    example: exampleFor(mode, ask),
    reminder: reminderFor(mode, ask),
    facts,
    summary: input.summary ? trimWords(input.summary, MAX_SUMMARY_WORDS) : "",
    gap: lastTalkedLine(input.lastTalked, input.openThreads),
    cards: mode === "help" ? input.cards.slice(0, 2) : [],
    recent: input.recent
      .slice(-KEEP_RECENT)
      .map((m) => ({ ...m, content: trimWords(m.content, MAX_MESSAGE_WORDS) })),
    user: trimWords(input.userMessage, MAX_USER_WORDS),
  };

  // Shrink in order of least importance until the prompt fits the budget.
  const over = () => countWords(assemble(parts)) > budget;
  // The example goes first: it helps tone, but the person's own conversation matters more.
  if (over()) parts.example = "";
  while (over() && parts.recent.length > 0) parts.recent.shift();
  if (over() && parts.summary) parts.summary = trimWords(parts.summary, 40);
  if (over() && parts.cards.length > 1) parts.cards = parts.cards.slice(0, 1);
  if (over()) parts.cards = [];
  if (over()) parts.facts = [];
  if (over()) parts.summary = "";
  if (over()) parts.gap = "";
  // Last resort (the smaller fallback budget): shorten the new message itself.
  if (over()) parts.user = trimWords(parts.user, 100);

  return assemble(parts);
}
