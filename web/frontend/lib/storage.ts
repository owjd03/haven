"use client";

import {
  DEFAULT_MODE,
  INITIAL_LISTEN_STATE,
  isChatMode,
  type ChatMode,
  type ListenState,
} from "@haven/backend";
import {
  makeSavedPlan,
  parseSavedPlan,
  planFromWeeks,
  type PlanDays,
  type PlanMode,
  type PlanSources,
  type PlanWeek,
  type SavedPlan,
} from "./plan";
import type { Profile, ProfileFact } from "./types";

// localStorage is only for small things: profile, settings, consent flags.
const PROFILE_KEY = "haven.profile";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be blocked or full; the app keeps working without persistence */
  }
}

export function getProfile(): Profile {
  const p = read<Partial<Profile>>(PROFILE_KEY, {});
  return { facts: Array.isArray(p.facts) ? p.facts : [] };
}

export function saveProfile(p: Profile): void {
  write(PROFILE_KEY, p);
}

export function addFact(text: string, source: "manual" | "suggested" = "manual"): Profile {
  const clean = text.trim();
  const p = getProfile();
  if (!clean) return p;
  const fact: ProfileFact = { id: crypto.randomUUID(), text: clean, source };
  const next = { facts: [...p.facts, fact] };
  saveProfile(next);
  return next;
}

export function removeFact(id: string): Profile {
  const next = { facts: getProfile().facts.filter((f) => f.id !== id) };
  saveProfile(next);
  return next;
}

/** Set once the person has read the opening page and agreed. Stays on this device (not in backups). */
export const AGREED_KEY = "haven.agreed";

export function hasAgreed(): boolean {
  try {
    return window.localStorage.getItem(AGREED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAgreed(): void {
  try {
    window.localStorage.setItem(AGREED_KEY, "1");
  } catch {
    /* ignore */
  }
}

const COUNTRY_KEY = "haven.country";

export function getCountry(): string | null {
  try {
    return window.localStorage.getItem(COUNTRY_KEY);
  } catch {
    return null;
  }
}

export function setCountry(code: string): void {
  try {
    window.localStorage.setItem(COUNTRY_KEY, code);
  } catch {
    /* ignore */
  }
}

// --- Chat style (all small, on-device, and wiped by "Delete everything") ---

const MODE_KEY = "haven.mode";
const LISTEN_KEY = "haven.listenState";
const RECENT_CARDS_KEY = "haven.recentCards";
const DISMISSED_KEY = "haven.dismissedMemories";
const RECENT_CARDS_KEPT = 10;
// Backup settings values are capped at 1000 characters, so keep this list short.
const DISMISSED_KEPT = 15;
const DISMISSED_CHARS = 50;

/** The reply mode the person chose. Listen on the very first run. */
export function getMode(): ChatMode {
  const v = read<unknown>(MODE_KEY, DEFAULT_MODE);
  return isChatMode(v) ? v : DEFAULT_MODE;
}

export function setMode(mode: ChatMode): void {
  write(MODE_KEY, mode);
}

export function getListenState(): ListenState {
  const v = read<Partial<ListenState>>(LISTEN_KEY, {});
  return {
    streak: typeof v.streak === "number" && v.streak >= 0 ? v.streak : INITIAL_LISTEN_STATE.streak,
    offered: v.offered === true,
    asked: v.asked === true,
  };
}

export function saveListenState(s: ListenState): void {
  write(LISTEN_KEY, s);
}

/** Ids of the coping cards used in the last few replies (so none is offered twice in a row). */
export function getRecentCards(): string[] {
  const v = read<unknown>(RECENT_CARDS_KEY, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function noteCardsUsed(ids: string[]): void {
  if (!ids.length) return;
  write(RECENT_CARDS_KEY, [...getRecentCards(), ...ids].slice(-RECENT_CARDS_KEPT));
}

/** Memories the person said "Not now" to, so they are never suggested again. */
export function getDismissedMemories(): string[] {
  const v = read<unknown>(DISMISSED_KEY, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function dismissMemory(text: string): void {
  write(
    DISMISSED_KEY,
    [...getDismissedMemories(), text.slice(0, DISMISSED_CHARS)].slice(-DISMISSED_KEPT),
  );
}

// --- Insights choices ---

const INSIGHTS_KEY = "haven.insights";

export interface InsightChoices {
  days: 7 | 30;
  journal: boolean;
  chats: boolean;
}

const DEFAULT_INSIGHTS: InsightChoices = { days: 7, journal: true, chats: true };

/** Last range and sources picked on the Insights page. At least one source is always on. */
export function getInsightChoices(): InsightChoices {
  const v = read<Partial<InsightChoices>>(INSIGHTS_KEY, {});
  const journal = typeof v.journal === "boolean" ? v.journal : true;
  const chats = typeof v.chats === "boolean" ? v.chats : true;
  if (!journal && !chats) return DEFAULT_INSIGHTS;
  return { days: v.days === 30 ? 30 : 7, journal, chats };
}

export function saveInsightChoices(c: InsightChoices): void {
  write(INSIGHTS_KEY, c);
}

// --- Small steps ---

const STEPS_CHOICES_KEY = "haven.stepsChoices";
const PLAN_KEY = "haven.plan";

export interface StepsChoices extends PlanSources {
  days: PlanDays;
  /** Private writes the plan on this device; cloud asks first. Private unless the person picks cloud. */
  mode: PlanMode;
}

const DEFAULT_STEPS: StepsChoices = {
  days: 7,
  journal: true,
  chats: true,
  aboutMe: true,
  mode: "private",
};

/** Last range and sources picked on the Small steps page. At least one source is always on. */
export function getStepsChoices(): StepsChoices {
  const v = read<Partial<StepsChoices>>(STEPS_CHOICES_KEY, {});
  const pick = (x: unknown) => (typeof x === "boolean" ? x : true);
  const c = { journal: pick(v.journal), chats: pick(v.chats), aboutMe: pick(v.aboutMe) };
  const mode: PlanMode = v.mode === "cloud" ? "cloud" : "private";
  if (!c.journal && !c.chats && !c.aboutMe) return { ...DEFAULT_STEPS, mode };
  return { days: v.days === 30 ? 30 : 7, ...c, mode };
}

export function saveStepsChoices(c: StepsChoices): void {
  write(STEPS_CHOICES_KEY, c);
}

/** The latest plan, or null if there isn't one (or what is stored isn't a valid plan). */
export function getPlan(): SavedPlan | null {
  return parseSavedPlan(read<unknown>(PLAN_KEY, null));
}

/** Keeps a new plan from a model reply, replacing the old one. */
export function savePlan(
  reply: string,
  meta: {
    days: PlanDays;
    sources: PlanSources;
    lowMood: boolean;
    basedOn?: string[];
    mode?: PlanMode;
  },
  now = Date.now(),
): SavedPlan {
  const plan = makeSavedPlan(reply, { madeAt: now, ...meta });
  write(PLAN_KEY, plan);
  return plan;
}

/** Keeps a plan that was written week by week (the private way), replacing the old one. */
export function savePlanWeeks(
  weeks: PlanWeek[],
  closing: string,
  meta: {
    days: PlanDays;
    sources: PlanSources;
    lowMood: boolean;
    basedOn?: string[];
    mode?: PlanMode;
  },
  now = Date.now(),
): SavedPlan {
  const plan = planFromWeeks(weeks, closing, { madeAt: now, ...meta });
  write(PLAN_KEY, plan);
  return plan;
}

export function deletePlan(): void {
  try {
    window.localStorage.removeItem(PLAN_KEY);
  } catch {
    /* storage may be blocked */
  }
}
