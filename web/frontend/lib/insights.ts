"use client";

/**
 * Insights (cloud, asks first): a gentle look back over the last 7 or 30 days, using the journal,
 * chats, or both. Everything here runs on the device; the gathered text only leaves after the
 * person reviews the privacy-shield preview and presses Send.
 */
import { retrieve, type NoteColor } from "@haven/backend";
import { getJournalSince, getMessagesSince, getSummariesSince } from "./db";
import { dayStart, formatDay, isSendable, localDayKey, noteColorFor, shiftDay } from "./journal";
import { countWords, trimWords } from "./promptBuilder";
import type { ChatMessage, JournalEntry, SummaryRecord } from "./types";

/** Words of personal text allowed in one cloud request. */
export const INSIGHTS_MAX_WORDS = 900;
/** When both sources are chosen and there is chat, the journal may use up to this share. */
export const JOURNAL_SHARE = 0.6;
/** How many words of each kind of item are sent. Small steps raises these, since a plan wants more context. */
export interface ItemLimits {
  entry: number;
  summary: number;
  message: number;
}
export const DEFAULT_LIMITS: ItemLimits = { entry: 80, summary: 80, message: 40 };
/** How many words of an item are shown in its row in the list. */
const PREVIEW_WORDS = 30;

/** Average rating at or below this, over at least MIN_ENTRIES_FOR_NOTE entries, shows the support note. */
export const LOW_MOOD_AVERAGE = 3;
export const MIN_ENTRIES_FOR_NOTE = 2;

export const INSIGHT_RANGES = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
] as const;
export type InsightRange = (typeof INSIGHT_RANGES)[number]["days"];

export interface InsightSources {
  journal: boolean;
  chats: boolean;
}

export interface InsightInput {
  sources: InsightSources;
  journal: JournalEntry[];
  summaries: SummaryRecord[];
  messages: ChatMessage[];
}

/** One thing the person can choose to send: a journal note, a chat summary, or one of their messages. */
export interface InsightItem {
  /** Stable across renders: "j:<id>", "s:<id>" or "m:<id>". */
  id: string;
  kind: "journal" | "summary" | "message";
  /** The day it belongs to, "YYYY-MM-DD" (local time). */
  day: string;
  /** For ordering within a day. */
  ts: number;
  /** Journal notes only: the person's own 1-10 rating and the note's paper colour. */
  mood?: number;
  color?: NoteColor;
  /** A crisis-flagged journal note. Never sent to any AI, never selectable, and its text isn't kept here. */
  locked: boolean;
  /** The first few words, for the row. Empty when locked. */
  preview: string;
  /** The whole text, for the popup. Empty when locked. */
  full: string;
  /** The line as it would be sent (cut to the item's word limit). Empty when locked. */
  sent: string;
  /** True when the full text is longer than what is sent. */
  truncated: boolean;
  /** How many words of the full text are sent. */
  limitWords: number;
}

export interface GatheredInsights {
  /** The text for the shield preview, grouped by day, oldest first. Empty if nothing can be sent. */
  text: string;
  /** Days that have something in the text. */
  days: number;
  /** Journal entries included in the text. */
  journalEntries: number;
  /** Sendable (not crisis-flagged) journal entries in the range, whether ticked or not. */
  journalInRange: number;
  /** Journal entries left out because they contain crisis language. Never sent to any AI. */
  excluded: number;
  /** Days of chat included in the text. */
  chatDays: number;
  /** Average of the person's own 1-10 ratings over ALL sendable entries in range, ticked or not, or null. */
  averageMood: number | null;
  /** Words of everything the person has ticked (more than `words` if some won't fit). */
  selectedWords: number;
  /** Words that will actually be sent, within the 900-word budget. */
  words: number;
  /** Ticked items that are left out because the budget is full. */
  wontFit: string[];
}

const newestFirst = (a: { day: string; ts: number }, b: { day: string; ts: number }) =>
  a.day === b.day ? b.ts - a.ts : a.day < b.day ? 1 : -1;

function item(
  base: Pick<InsightItem, "id" | "kind" | "day" | "ts" | "mood" | "color">,
  full: string,
  limitWords: number,
  lineFor: (trimmed: string) => string,
): InsightItem {
  return {
    ...base,
    locked: false,
    preview: trimWords(full, PREVIEW_WORDS),
    full: full.trim(),
    sent: lineFor(trimWords(full, limitWords)),
    truncated: countWords(full) > limitWords,
    limitWords,
  };
}

/**
 * Every candidate item in the range, newest day first (and newest first within a day). The caller
 * passes only records inside the chosen range. Journal notes with crisis language are listed as
 * locked, with no text. Chat items are the person's own messages that haven't been folded into a
 * summary yet, plus the summaries; Haven's replies are never listed, because they are never sent.
 */
export function listInsightItems(
  { sources, journal, summaries, messages }: InsightInput,
  limits: ItemLimits = DEFAULT_LIMITS,
): InsightItem[] {
  const items: InsightItem[] = [];
  if (sources.journal) {
    for (const e of journal) {
      const base = {
        id: `j:${e.id ?? `${e.day}:${e.createdAt}`}`,
        kind: "journal" as const,
        day: e.day,
        ts: e.createdAt,
        mood: e.mood,
        color: noteColorFor(e),
      };
      if (!isSendable(e)) {
        items.push({
          ...base,
          locked: true,
          preview: "",
          full: "",
          sent: "",
          truncated: false,
          limitWords: 0,
        });
      } else {
        items.push(item(base, e.text, limits.entry, (t) => `Journal (mood ${e.mood} of 10): ${t}`));
      }
    }
  }
  if (sources.chats) {
    for (const s of summaries) {
      items.push(
        item(
          {
            id: `s:${s.id ?? s.createdAt}`,
            kind: "summary",
            day: localDayKey(s.createdAt),
            ts: s.createdAt,
          },
          s.text,
          limits.summary,
          (t) => `Chat summary: ${t}`,
        ),
      );
    }
    for (const m of messages) {
      if (m.role !== "user" || m.summarized) continue;
      items.push(
        item(
          { id: `m:${m.id ?? m.ts}`, kind: "message", day: localDayKey(m.ts), ts: m.ts },
          m.content,
          limits.message,
          (t) => `Chat: ${t}`,
        ),
      );
    }
  }
  return items.sort(newestFirst);
}

/**
 * Pure part of Insights: builds the text to send from the ticked items. With no `selected` set,
 * everything is ticked.
 * - Journal: newest first, within its share of the budget (all of it if no chat is ticked).
 * - Chats get what's left: summaries first (they are compact), then the person's own messages,
 *   newest first.
 * `budget` is the word limit (900 unless the caller needs room for something else, or more), and
 * `limits` how many words of each item are kept.
 * Whatever doesn't fit is reported in `wontFit`. The output groups each day's lines together,
 * oldest day first. Crisis-flagged notes are never included, ticked or not.
 */
export function buildInsights(
  input: InsightInput,
  selected?: ReadonlySet<string>,
  budget = INSIGHTS_MAX_WORDS,
  limits: ItemLimits = DEFAULT_LIMITS,
): GatheredInsights {
  const items = listInsightItems(input, limits);
  const locked = items.filter((i) => i.locked);
  const ticked = items.filter((i) => !i.locked && (!selected || selected.has(i.id)));
  const sendable = items.filter((i) => i.kind === "journal" && !i.locked);

  const journalItems = ticked.filter((i) => i.kind === "journal");
  const chatSummaries = ticked.filter((i) => i.kind === "summary");
  const chatMessages = ticked.filter((i) => i.kind === "message");
  const hasChat = chatSummaries.length + chatMessages.length > 0;

  const included: InsightItem[] = [];
  const wontFit: string[] = [];
  let words = 0;
  // Newest first; stops at the first item that doesn't fit, so the newest are the ones kept.
  // The very first item is always kept, so a single long note is never refused outright.
  const fill = (list: InsightItem[], budget: number) => {
    let cut = false;
    for (const i of list) {
      const w = countWords(i.sent);
      if (cut || (words + w > budget && words > 0)) {
        cut = true;
        wontFit.push(i.id);
        continue;
      }
      included.push(i);
      words += w;
    }
  };
  fill(journalItems, hasChat ? Math.floor(budget * JOURNAL_SHARE) : budget);
  fill(chatSummaries, budget);
  fill(chatMessages, budget);

  // Group by day, oldest day first; within a day: journal, summaries, then messages in order.
  const byDay = new Map<string, InsightItem[]>();
  for (const i of included) byDay.set(i.day, [...(byDay.get(i.day) ?? []), i]);
  const order = { journal: 0, summary: 1, message: 2 } as const;
  const days = [...byDay.keys()].sort();
  const lines = (list: InsightItem[]) =>
    [...list]
      .sort((a, b) => order[a.kind] - order[b.kind] || a.ts - b.ts)
      .map((i) => i.sent)
      .join("\n");

  const moods = sendable.map((i) => i.mood ?? 0);
  return {
    text: days.map((d) => `${formatDay(d)}:\n${lines(byDay.get(d)!)}`).join("\n\n"),
    days: days.length,
    journalEntries: included.filter((i) => i.kind === "journal").length,
    journalInRange: sendable.length,
    excluded: locked.length,
    chatDays: days.filter((d) => byDay.get(d)!.some((i) => i.kind !== "journal")).length,
    averageMood: moods.length
      ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10
      : null,
    selectedWords: ticked.reduce((sum, i) => sum + countWords(i.sent), 0),
    words,
    wontFit,
  };
}

/**
 * The order the lists show items in: newest day first (items arrive that way), and within a day a
 * chat summary first, then the rest in their given order.
 */
export function orderForDisplay(items: InsightItem[]): InsightItem[] {
  const days = [...new Set(items.map((i) => i.day))];
  return days.flatMap((day) =>
    items
      .filter((i) => i.day === day)
      .sort((a, b) => Number(b.kind === "summary") - Number(a.kind === "summary")),
  );
}

/** What the word meter shows. The numbers are also given as text, so colour is never the only signal. */
export interface MeterInfo {
  /** "640 of 900 words". */
  label: string;
  /** How full the bar is, 0 to 100. */
  percent: number;
  /** True when something ticked won't fit, so the bar is shown as full. */
  over: boolean;
  /** Plain-text lines under the bar. */
  notes: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function meterInfo(
  g: Pick<GatheredInsights, "selectedWords" | "wontFit" | "excluded">,
  max = INSIGHTS_MAX_WORDS,
): MeterInfo {
  const over = g.wontFit.length > 0 || g.selectedWords > max;
  const notes: string[] = [];
  if (g.wontFit.length > 0)
    notes.push(
      `${plural(g.wontFit.length, "selected item won't", "selected items won't")} fit and will not be sent. ` +
        "They're marked in the lists. Select fewer to make room.",
    );
  if (g.excluded > 0)
    notes.push(
      `${plural(g.excluded, "journal entry was", "journal entries were")} left out and ${
        g.excluded === 1 ? "is" : "are"
      } never sent to any AI.`,
    );
  return {
    label: `${g.selectedWords} of ${max} words`,
    percent: Math.min(100, Math.round((g.selectedWords / max) * 100)),
    over,
    notes,
  };
}

/** Loads the chosen range from this device. Calendar days, today included. */
export async function loadInsightInput(
  rangeDays: number,
  sources: InsightSources,
  now = Date.now(),
): Promise<InsightInput> {
  const sinceKey = shiftDay(localDayKey(now), -(rangeDays - 1));
  const since = dayStart(sinceKey);
  const [journal, summaries, messages] = await Promise.all([
    sources.journal ? getJournalSince(sinceKey) : Promise.resolve([]),
    sources.chats ? getSummariesSince(since) : Promise.resolve([]),
    sources.chats ? getMessagesSince(since) : Promise.resolve([]),
  ]);
  return { sources, journal, summaries, messages };
}

/** True when the person's own ratings are low enough to show the plain-code support note. */
export function showsLowMoodNote(
  g: Pick<GatheredInsights, "averageMood" | "journalInRange">,
): boolean {
  return (
    g.averageMood !== null &&
    g.journalInRange >= MIN_ENTRIES_FOR_NOTE &&
    g.averageMood <= LOW_MOOD_AVERAGE
  );
}

// ---------- the cloud request ----------

function sourcePhrase(s: InsightSources): string {
  if (s.journal && s.chats) return "their chats with Haven and their journal";
  if (s.journal) return "their journal";
  return "their chats with Haven";
}

/**
 * The fixed instruction. It never contains the person's words: technique cards are generic text,
 * retrieved here on the device from the gathered text.
 */
export function insightsInstruction(gatheredText: string, sources: InsightSources): string {
  const base =
    `You are Haven, a gentle companion (not a therapist). Below are a person's own notes from ${sourcePhrase(sources)}, grouped by day, oldest first. ` +
    (sources.journal
      ? "Journal lines include the person's own rating of how they felt, from 1 (really low) to 10 (really good). The rating is their own number, not a measurement; never interpret it clinically. "
      : "") +
    "Write a short, warm reply in plain language, under 250 words, with no headings and no lists. Gently cover: " +
    "which days seemed hardest and which lighter; themes that keep coming up; " +
    (sources.journal ? "patterns between how they felt and what they wrote; " : "") +
    "anything that seemed to help, using their own words; and two or three small, kind, practical suggestions they could try. " +
    "Only if it would truly help, mention that talking to someone they trust or a counselor is an option. " +
    "Never diagnose, never label a pattern as a condition, and don't give medical advice. Don't scold or set goals, and don't mention streaks or missed days. " +
    "Speak to them directly as 'you'.";
  const cards = retrieve(gatheredText, 2);
  if (cards.length === 0) return base;
  return (
    base +
    " If one of these gentle techniques fits what they wrote, you may suggest it in your own words (don't force it): " +
    cards.map(({ card }) => `${card.title}: ${card.text}`).join(" | ")
  );
}
