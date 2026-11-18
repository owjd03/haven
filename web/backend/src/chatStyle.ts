/**
 * Plain-code rules for how Haven chats: reply modes, help-intent detection, the structured summary,
 * time-since-last-chat, and vetting of suggested memories. No model, no network. Runs in the browser.
 */
import { detectCrisis } from "./crisis";
import { tokenize } from "./retrieval";
import type { CopingCard } from "./types";

export type ChatMode = "listen" | "help";
export const DEFAULT_MODE: ChatMode = "listen";
export const isChatMode = (v: unknown): v is ChatMode => v === "listen" || v === "help";

/** Clear asks for advice. Everyday venting and small talk must not match. */
const HELP_PATTERNS: RegExp[] = [
  /\bwhat (should|can|could|do) i (do|try)\b/,
  /\bwhat do i do\b/,
  /\bhow (do|can|should|could) i\b/,
  /\bshould i\b/,
  /\b(any|some|your) (tips|advice|ideas|suggestions|thoughts)\b/,
  /\bgive me (some )?(tips|advice|ideas|suggestions)\b/,
  /\bi need (some )?(advice|tips|ideas|suggestions)\b/,
  /\b(can|could) you (suggest|recommend|help me)\b/,
  /\bhelp me (with|figure|think|cope|deal|calm|stop|sleep|focus|decide|handle)\b/,
  /\bwhat would you (do|suggest|recommend)\b/,
  /\bany way to\b/,
];

export function detectHelpIntent(text: string): boolean {
  const t = text.toLowerCase().replace(/[’']/g, "'");
  return HELP_PATTERNS.some((re) => re.test(t));
}

/** The reply mode for one message: the saved choice, or Help for this reply only on a clear ask. */
export function resolveMode(saved: ChatMode, text: string): ChatMode {
  return saved === "help" || detectHelpIntent(text) ? "help" : "listen";
}

/** After this many Listen replies in a row, Haven asks once whether the person wants ideas. */
export const OFFER_AFTER_LISTEN_TURNS = 3;

export interface ListenState {
  /** Listen replies in a row since the start or the last Help reply. */
  streak: number;
  /** True once the "ideas or just get it out?" question has been asked in this streak. */
  offered: boolean;
  /** True if the last Listen reply asked a question. Listen replies alternate: question, then invitation. */
  asked: boolean;
}

export const INITIAL_LISTEN_STATE: ListenState = { streak: 0, offered: false, asked: false };

/** Listen replies alternate: one that asks a question, then one that only invites more. */
export function shouldAskQuestion(s: ListenState): boolean {
  return !s.asked;
}

/**
 * True when this reply should end with the one-time "ideas or just get it out?" question. That is
 * itself a question, so it only happens on a turn that asks one.
 */
export function shouldOfferIdeas(s: ListenState): boolean {
  return shouldAskQuestion(s) && !s.offered && s.streak >= OFFER_AFTER_LISTEN_TURNS;
}

/** Update the Listen state after a reply is written. A Help reply resets everything. */
export function nextListenState(
  s: ListenState,
  mode: ChatMode,
  turn: { asked: boolean; offered: boolean },
): ListenState {
  if (mode === "help") return INITIAL_LISTEN_STATE;
  return { streak: s.streak + 1, offered: s.offered || turn.offered, asked: turn.asked };
}

// --- Structured summary ---

export const SUMMARY_LABELS = [
  "Going on",
  "Feeling",
  "Tried / didn't help",
  "Helped",
  "Open threads",
] as const;

export interface ParsedSummary {
  goingOn: string;
  feeling: string;
  tried: string;
  helped: string;
  openThreads: string;
}

const NONE = /^(none|nothing|n\/a|-|—|not mentioned|unknown)\.?$/i;

/** Reads the labelled summary lines. Old paragraph summaries simply give empty fields. */
export function parseSummary(text: string): ParsedSummary {
  const out: ParsedSummary = { goingOn: "", feeling: "", tried: "", helped: "", openThreads: "" };
  const keys: Array<[RegExp, keyof ParsedSummary]> = [
    [/^going on\s*:/i, "goingOn"],
    [/^feeling\s*:/i, "feeling"],
    [/^tried(\s*\/\s*didn'?t help)?\s*:/i, "tried"],
    [/^helped\s*:/i, "helped"],
    [/^open threads?\s*:/i, "openThreads"],
  ];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/^[\s*\-•]+/, "")
      .replace(/\*\*/g, "")
      .trim();
    for (const [re, key] of keys) {
      if (re.test(line)) {
        const v = line.replace(re, "").trim();
        out[key] = NONE.test(v) ? "" : v;
      }
    }
  }
  return out;
}

/** True when a card's technique looks like something the person already said they tried. */
export function cardWasTried(card: CopingCard, tried: string): boolean {
  if (!tried.trim()) return false;
  const triedTokens = tokenize(tried);
  // A word matches itself or a longer form of it ("breath" and "breathing").
  const same = (a: string, b: string) => {
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= 4 && long.startsWith(short);
  };
  return tokenize(card.title)
    .filter((t) => t.length >= 4)
    .some((t) => triedTokens.some((u) => same(t, u)));
}

// --- Time since last chat ---

export const GAP_HOURS = 6;

/** A short phrase like "3 days ago", or null when it has been less than GAP_HOURS. */
export function gapLabel(ms: number): string | null {
  const hours = ms / 3_600_000;
  if (!Number.isFinite(hours) || hours < GAP_HOURS) return null;
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return days === 1 ? "yesterday" : `${days} days ago`;
  const weeks = Math.round(days / 7);
  return weeks < 9 ? `${weeks} weeks ago` : "a long while ago";
}

// --- Suggested memories ---

export const MIN_MEMORY_MESSAGE_WORDS = 8;
const MAX_MEMORY_CHARS = 120;
const MAX_MEMORY_WORDS = 16;

/** Health and crisis details are never suggested as memories. */
const SENSITIVE =
  /\b(diagnos\w*|depress\w*|anxiety disorder|bipolar|adhd|ptsd|ocd|schizo\w*|autis\w*|medicat\w*|meds|prescri\w*|antidepress\w*|therap\w*|psychiatr\w*|disorder|eating disorder|anorex\w*|bulim\w*|self[- ]?harm\w*|suicid\w*|abus\w*|assault\w*|rape\w*|pregnan\w*|abortion|overdos\w*|cutting|panic attacks?)\b/i;

const normalizeMemory = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Checks one candidate fact from the on-device model. Returns the cleaned fact, or null to drop it
 * (empty, too long, crisis or health related, or already known / already declined).
 */
export function vetMemory(candidate: string, known: string[], dismissed: string[]): string | null {
  let c = candidate
    .trim()
    .split(/\r?\n/)[0]
    .replace(/^[\s*\-•"'“”]+|["'“”\s]+$/g, "")
    .replace(/^(fact|memory)\s*:\s*/i, "")
    .trim();
  if (!c || NONE.test(c) || /^no (lasting )?(fact|memory)\b/i.test(c)) return null;
  if (c.length < 4 || c.length > MAX_MEMORY_CHARS) return null;
  if (c.split(/\s+/).length > MAX_MEMORY_WORDS) return null;
  if (detectCrisis(c).matched || SENSITIVE.test(c)) return null;
  const n = normalizeMemory(c);
  if (!n) return null;
  for (const other of [...known, ...dismissed]) {
    const o = normalizeMemory(other);
    if (o && (o === n || o.includes(n) || n.includes(o))) return null;
  }
  return c.charAt(0).toUpperCase() + c.slice(1);
}
