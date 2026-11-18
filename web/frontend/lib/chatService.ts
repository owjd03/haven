"use client";

import {
  COPING_CARDS,
  MIN_MEMORY_MESSAGE_WORDS,
  cardWasTried,
  detectCrisis,
  gapLabel,
  nextListenState,
  parseSummary,
  resolveMode,
  retrieve,
  shouldAskQuestion,
  shouldOfferIdeas,
  vetMemory,
  type ChatMode,
} from "@haven/backend";
import { chat, chatStream, extractMemory, summarize } from "./ai";
import { finishReply } from "./format";
import { addMessage, addSummary, getAllMessages, getLatestSummary, markSummarized } from "./db";
import {
  buildPrompt,
  countWords,
  FALLBACK_WORDS,
  instructionFor,
  KEEP_RECENT,
  lastTalkedLine,
  SUMMARY_THRESHOLD,
  trimWords,
} from "./promptBuilder";
import {
  dismissMemory,
  getDismissedMemories,
  getListenState,
  getMode,
  getProfile,
  getRecentCards,
  noteCardsUsed,
  saveListenState,
} from "./storage";
import type { ChatMessage } from "./types";

export class CrisisDetectedError extends Error {
  constructor() {
    super("Crisis language detected; no model was called.");
    this.name = "CrisisDetectedError";
  }
}

/** What was decided for one reply. `commitTurn` records it once the reply is really shown. */
export interface TurnPlan {
  /** The mode used for this reply (a clear ask for help switches it for this reply only). */
  mode: ChatMode;
  /** Listen replies alternate: true ends with a question, false with a gentle invitation. */
  askQuestion: boolean;
  offerIdeas: boolean;
  /** Coping cards for this reply. Always empty in Listen mode. */
  cards: Array<{ id: string; title: string; text: string }>;
  summaryText?: string;
  lastTalked?: string;
  openThreads?: string;
}

/** Decide mode, cards and time gap for a reply. Pure apart from reading small on-device settings. */
export async function planTurn(
  userText: string,
  recent: ChatMessage[],
  now = Date.now(),
): Promise<TurnPlan> {
  const summary = await getLatestSummary();
  const parsed = parseSummary(summary?.text ?? "");
  const mode = resolveMode(getMode(), userText);
  const listen = getListenState();
  const askQuestion = mode === "help" || shouldAskQuestion(listen);
  const offerIdeas = mode === "listen" && shouldOfferIdeas(listen);

  let cards: TurnPlan["cards"] = [];
  if (mode === "help") {
    // Skip cards offered in the last few replies and techniques the person said they already tried.
    const skip = new Set(getRecentCards());
    const pool = COPING_CARDS.filter((c) => !skip.has(c.id) && !cardWasTried(c, parsed.tried));
    cards = retrieve(userText, 2, pool).map(({ card }) => ({
      id: card.id,
      title: card.title,
      text: card.text,
    }));
  }

  // After a long gap, let Haven know, and remind it what was left open. Only when the person writes.
  const last = recent.filter((m) => !m.error && !m.notice).at(-1);
  const gap = last ? gapLabel(now - last.ts) : null;

  return {
    mode,
    askQuestion,
    offerIdeas,
    cards,
    summaryText: summary?.text,
    ...(gap ? { lastTalked: gap, openThreads: parsed.openThreads || undefined } : {}),
  };
}

/** Record the Listen streak and the cards used, after a reply has been shown. */
export function commitTurn(plan: TurnPlan): void {
  saveListenState(
    nextListenState(getListenState(), plan.mode, {
      asked: plan.askQuestion,
      offered: plan.offerIdeas,
    }),
  );
  noteCardsUsed(plan.cards.map((c) => c.id));
}

/** True when an error looks like "the prompt was too long for the model". */
export function looksTooLong(e: unknown): boolean {
  const msgs = [(e as Error)?.message, ((e as { cause?: unknown })?.cause as Error)?.message];
  return msgs.some(
    (m) =>
      typeof m === "string" &&
      /too (long|large|many)|quota|exceed|context (window|length)|token limit|input.*limit/i.test(
        m,
      ),
  );
}

/**
 * Generates Haven's reply on-device to a user message that is already saved.
 * `recent` is the conversation BEFORE the new message. `onPartial` streams text as it is generated.
 */
export async function generateReply(
  userText: string,
  recent: ChatMessage[],
  onPartial?: (textSoFar: string) => void,
): Promise<ChatMessage> {
  // Backstop: the UI checks first, but NO model call may ever happen on crisis language.
  if (detectCrisis(userText).matched) throw new CrisisDetectedError();
  const plan = await planTurn(userText, recent);
  const build = (maxWords?: number) =>
    buildPrompt({
      mode: plan.mode,
      offerIdeas: plan.offerIdeas,
      askQuestion: plan.askQuestion,
      profileFacts: getProfile().facts.map((f) => f.text),
      summary: plan.summaryText,
      lastTalked: plan.lastTalked,
      openThreads: plan.openThreads,
      recent: recent.slice(-KEEP_RECENT).map((m) => ({ role: m.role, content: m.content })),
      cards: plan.cards,
      userMessage: userText,
      maxWords,
    });
  const run = (prompt: string) => (onPartial ? chatStream(prompt, onPartial) : chat(prompt));

  let text: string;
  try {
    ({ text } = await run(build()));
  } catch (e) {
    // The prompt may be too long for this device's model: try once more with a smaller one.
    if (!looksTooLong(e)) throw e;
    ({ text } = await run(build(FALLBACK_WORDS)));
  }

  const reply = await addMessage({
    role: "assistant",
    content:
      finishReply(text, plan.mode) || "I'm here with you. Would you like to tell me a bit more?",
    ts: Date.now(),
    summarized: false,
    source: "on_device",
  });
  commitTurn(plan);

  void maybeSummarize(); // background; never blocks the chat
  return reply;
}

/**
 * Builds the cloud request for a chat message. `personalText` holds everything that came from the
 * user (profile, summary, recent messages, new message) and MUST go through the privacy shield.
 * `instruction` holds only Haven's fixed guidance and coping cards, so it is safe to send as-is.
 * Call `commitTurn(plan)` once the reply has been shown.
 */
export async function buildCloudRequest(userText: string, recent: ChatMessage[]) {
  if (detectCrisis(userText).matched) throw new CrisisDetectedError();
  const plan = await planTurn(userText, recent);
  const facts = getProfile().facts.map((f) => f.text);
  const parts: string[] = [];
  if (facts.length)
    parts.push("About me:\n" + facts.map((f) => `- ${trimWords(f, 30)}`).join("\n"));
  if (plan.summaryText) parts.push("Earlier, in short:\n" + trimWords(plan.summaryText, 130));
  const gap = lastTalkedLine(plan.lastTalked, plan.openThreads);
  if (gap) parts.push(gap);
  const lines = recent
    .slice(-KEEP_RECENT)
    .map((m) => `${m.role === "user" ? "Me" : "Haven"}: ${trimWords(m.content, 80)}`);
  if (lines.length) parts.push("Recent messages:\n" + lines.join("\n"));
  parts.push(`My new message:\n${userText}`);

  const instruction =
    instructionFor(plan.mode, plan.offerIdeas, plan.askQuestion) +
    " The text below is written by the user in first person." +
    (plan.cards.length
      ? "\n\nA gentle technique you may offer if it fits (don't force it):\n" +
        plan.cards.map((c) => `- ${c.title}: ${c.text}`).join("\n")
      : "");
  return { personalText: parts.join("\n\n"), instruction, plan };
}

export function saveCloudReply(text: string, mode: ChatMode = "listen"): Promise<ChatMessage> {
  return addMessage({
    role: "assistant",
    content: finishReply(text, mode) || "I'm here with you. Would you like to tell me a bit more?",
    ts: Date.now(),
    summarized: false,
    source: "cloud",
  });
}

/**
 * Asks the on-device model for ONE lasting fact in a message the person just sent, and checks it in
 * plain code. Returns null when there is nothing worth suggesting. Never runs in the cloud and never
 * on crisis text. The person decides whether to keep it.
 */
export async function suggestMemory(userText: string): Promise<string | null> {
  if (countWords(userText) < MIN_MEMORY_MESSAGE_WORDS) return null;
  if (detectCrisis(userText).matched) return null;
  try {
    const { text } = await extractMemory(userText);
    return vetMemory(
      text,
      getProfile().facts.map((f) => f.text),
      getDismissedMemories(),
    );
  } catch {
    return null; // best-effort: a failed suggestion is never shown as an error
  }
}

export { dismissMemory };

let summarizing = false;

/** Fold the oldest unsummarized messages into the rolling summary once enough have piled up (on-device only). */
export async function maybeSummarize(): Promise<void> {
  if (summarizing) return;
  summarizing = true;
  try {
    const all = await getAllMessages();
    const unsummarized = all.filter((m) => !m.summarized);
    if (unsummarized.length < SUMMARY_THRESHOLD) return;

    const batch = unsummarized.slice(0, unsummarized.length - KEEP_RECENT);
    const previous = await getLatestSummary();
    const transcript = batch
      .map((m) => `${m.role === "user" ? "User" : "Haven"}: ${m.content}`)
      .join("\n");
    const input =
      (previous ? `Previous note:\n${previous.text}\n\nNew messages:\n` : "") + transcript;

    const { text } = await summarize(input);
    if (!text.trim()) return;

    const ids = batch.map((m) => m.id!).filter((id): id is number => typeof id === "number");
    await addSummary({ createdAt: Date.now(), text: text.trim(), upToMessageId: Math.max(...ids) });
    await markSummarized(ids);
  } catch (e) {
    console.warn("[Haven] summarization skipped:", e);
  } finally {
    summarizing = false;
  }
}
