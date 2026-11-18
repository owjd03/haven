/**
 * Small steps: the plan itself. Pure helpers, no browser and no model. Turning a model reply into
 * steps, and reading and checking a saved plan, both live here so they can be tested on their own.
 */

export const PLAN_RANGES = [7, 30] as const;
export type PlanDays = (typeof PLAN_RANGES)[number];

export interface PlanSources {
  journal: boolean;
  chats: boolean;
  aboutMe: boolean;
}

/** One longer-term activity in a plan. */
export interface PlanActivity {
  title: string;
  /** What it is, in a sentence. */
  what: string;
  /** Why it might help this person. */
  why: string;
  /** A concrete first step. */
  firstStep: string;
  /** Roughly how often, e.g. "once a week". */
  often: string;
}

export interface PlanWeek {
  n: number;
  /** A short theme for the week, e.g. "Rebuild a routine". */
  theme: string;
  activities: PlanActivity[];
}

export interface ParsedPlan {
  /** Up to three short steps, without their numbers. */
  steps: string[];
  /** The gentle line about talking to someone, or "" if the reply had none. */
  closing: string;
}

/** What is kept on this device. Strings are capped, so a plan always fits in a backup. */
export interface SavedPlan {
  /** The whole reply, shown as plain text if it didn't come back as steps or weeks. Empty for a weeks plan. */
  text: string;
  /** A short list of steps (plans made before 4-week plans existed). */
  steps: string[];
  /** The 4-week plan: weeks of activities. */
  weeks?: PlanWeek[];
  closing: string;
  madeAt: number;
  days: PlanDays;
  sources: PlanSources;
  /** True if the person's own ratings were low when it was made (shows the support note). */
  lowMood: boolean;
  /** Publishers of the general guidance the writer was given (e.g. "NHS"). Shown as what it was built on. */
  basedOn?: string[];
  /** Who wrote it: a small model on this device, or the cloud model. Plans saved before this count as cloud. */
  mode?: PlanMode;
}

export type PlanMode = "private" | "cloud";

const MAX_TEXT = 6000;
const MAX_STEP = 400;
const MAX_CLOSING = 400;
const MAX_STEPS = 3;
const MAX_WEEKS = 4;
const MAX_ACTIVITIES = 4;
const MAX_THEME = 80;
const MAX_TITLE = 80;
const MAX_FIELD = 240;
const MAX_OFTEN = 80;
const MAX_BASED_ON = 8;
const MAX_BASED_ON_NAME = 80;

const cut = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…");
const strip = (s: string) =>
  s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Reads a reply written as numbered steps ("1. ...", "2) ...") and an optional closing line. Anything
 * before the first step is dropped. Returns null if there are fewer than two steps, so the caller
 * can show the reply as plain text instead of failing. More than three steps keeps the first three.
 */
export function parseSteps(reply: string): ParsedPlan | null {
  const steps: string[] = [];
  const closing: string[] = [];
  let afterSteps = false;
  let lastWasBlank = false;
  for (const raw of reply.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      lastWasBlank = true;
      continue;
    }
    const m = /^(?:[-*•]\s*)?(?:\*\*)?(\d{1,2})[.)]\s*(?:\*\*)?\s*(.*)$/.exec(line);
    if (m) {
      steps.push(strip(m[2]));
      afterSteps = false;
    } else if (steps.length === 0) {
      // Introduction before the first step.
    } else if (!afterSteps && !lastWasBlank) {
      // A wrapped line belonging to the step above.
      steps[steps.length - 1] = strip(`${steps[steps.length - 1]} ${line}`);
    } else {
      afterSteps = true;
      closing.push(strip(line));
    }
    lastWasBlank = false;
  }
  const kept = steps.filter(Boolean).slice(0, MAX_STEPS);
  if (kept.length < 2) return null;
  return { steps: kept.map((s) => cut(s, MAX_STEP)), closing: cut(closing.join(" "), MAX_CLOSING) };
}

const WEEK_RE =
  /^(?:#{1,6}\s*)?(?:\*\*)?\s*week\s+(\d{1,2})\s*(?:\*\*)?\s*[:.\-\u2013\u2014]?\s*(.*)$/i;
const BULLET_RE = /^(?:[-*\u2022]|\d{1,2}[.)])\s+(.*)$/;
const CLOSING_RE = /^(?:\*\*)?closing(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*)$/i;

/** "Title: what it is. Why: ... First step: ... How often: ..." into its parts. */
function parseActivity(raw: string): PlanActivity {
  const text = strip(raw);
  const marks = [
    { key: "why", re: /\bWhy:\s*/i },
    { key: "firstStep", re: /\bFirst step:\s*/i },
    { key: "often", re: /\bHow often:\s*/i },
  ]
    .map((m) => {
      const hit = m.re.exec(text);
      return hit ? { key: m.key, at: hit.index, end: hit.index + hit[0].length } : null;
    })
    .filter((m): m is { key: string; at: number; end: number } => m !== null)
    .sort((a, b) => a.at - b.at);
  const head = (marks.length ? text.slice(0, marks[0].at) : text).trim();
  const fields: Record<string, string> = {};
  marks.forEach((m, i) => {
    fields[m.key] = text.slice(m.end, marks[i + 1]?.at ?? text.length).trim();
  });
  const split = /^(.{3,80}?):\s+(.+)$/.exec(head);
  const title = split ? split[1] : head.split(/[.,;]/)[0].slice(0, 60);
  const what = split ? split[2] : head;
  return {
    title: cut(title.trim(), MAX_TITLE),
    what: cut(what.trim(), MAX_FIELD),
    why: cut(fields.why ?? "", MAX_FIELD),
    firstStep: cut(fields.firstStep ?? "", MAX_FIELD),
    often: cut((fields.often ?? "").replace(/\.$/, ""), MAX_OFTEN),
  };
}

/**
 * Reads a plan written as "Week 1: theme" headings, "- activity" lines and a closing line. Anything
 * before the first week is dropped. Returns null if there are fewer than two weeks with activities,
 * so the caller can show the reply as plain text instead of failing.
 */
function readWeeks(reply: string): { weeks: PlanWeek[]; closing: string } {
  const raw: Array<{ n: number; theme: string; items: string[] }> = [];
  const closing: string[] = [];
  let lastWasBlank = false;
  let inClosing = false;
  for (const line0 of reply.replace(/\r/g, "").split("\n")) {
    const line = line0.trim();
    if (!line) {
      lastWasBlank = true;
      continue;
    }
    const week = WEEK_RE.exec(line);
    const closeLabel = CLOSING_RE.exec(line);
    const bullet = BULLET_RE.exec(line);
    const current = raw[raw.length - 1];
    if (week && !inClosing) {
      raw.push({ n: Number(week[1]), theme: strip(week[2]), items: [] });
    } else if (closeLabel && raw.length > 0) {
      inClosing = true;
      closing.push(strip(closeLabel[1]));
    } else if (inClosing) {
      closing.push(strip(line));
    } else if (!current) {
      // Introduction before the first week.
    } else if (bullet) {
      current.items.push(bullet[1]);
    } else if (current.items.length > 0 && !lastWasBlank) {
      // A wrapped line belonging to the activity above.
      current.items[current.items.length - 1] += ` ${line}`;
    } else if (lastWasBlank && current.items.length > 0) {
      // A paragraph after the last activity: the closing line.
      inClosing = true;
      closing.push(strip(line));
    } else if (current.items.length === 0) {
      // Words under a week heading but before its activities: part of the theme.
      current.theme = strip(`${current.theme} ${line}`);
    }
    lastWasBlank = false;
  }
  const weeks: PlanWeek[] = raw
    .map((w, i) => ({
      n: w.n >= 1 && w.n <= 99 ? w.n : i + 1,
      theme: cut(w.theme, MAX_THEME),
      activities: w.items
        .map(parseActivity)
        .filter((a) => a.what || a.title)
        .slice(0, MAX_ACTIVITIES),
    }))
    .filter((w) => w.activities.length > 0)
    .slice(0, MAX_WEEKS);
  return { weeks, closing: cut(closing.join(" ").trim(), MAX_CLOSING) };
}

export function parseWeeks(reply: string): { weeks: PlanWeek[]; closing: string } | null {
  const r = readWeeks(reply);
  return r.weeks.length < 2 ? null : r;
}

/** Reads one week written as "Week N: theme" and its activity lines. Returns null if it has no activities. */
export function parseSingleWeek(reply: string, n: number): PlanWeek | null {
  const first = readWeeks(reply).weeks[0];
  return first ? { ...first, n } : null;
}

/** A week whose reply couldn't be read as activities: its words are kept as plain text in one card. */
export function plainWeek(n: number, reply: string): PlanWeek | null {
  const text = strip(reply);
  if (!text) return null;
  return {
    n,
    theme: "",
    activities: [
      { title: "This week", what: cut(text, MAX_FIELD), why: "", firstStep: "", often: "" },
    ],
  };
}

/** Builds what gets saved from weeks that were written one at a time. */
export function planFromWeeks(
  weeks: PlanWeek[],
  closing: string,
  meta: {
    madeAt: number;
    days: PlanDays;
    sources: PlanSources;
    lowMood: boolean;
    basedOn?: string[];
    mode?: PlanMode;
  },
): SavedPlan {
  const { basedOn: names, ...rest } = meta;
  const basedOn = [...new Set((names ?? []).map((n) => cut(n, MAX_BASED_ON_NAME)))].slice(
    0,
    MAX_BASED_ON,
  );
  return {
    text: "",
    steps: [],
    weeks: weeks.slice(0, MAX_WEEKS),
    closing: cut(closing, MAX_CLOSING),
    ...rest,
    ...(basedOn.length ? { basedOn } : {}),
  };
}

/** Builds what gets saved from a reply: weeks if it came back as a 4-week plan, else steps, else plain text. */
export function makeSavedPlan(
  reply: string,
  meta: {
    madeAt: number;
    days: PlanDays;
    sources: PlanSources;
    lowMood: boolean;
    basedOn?: string[];
    mode?: PlanMode;
  },
): SavedPlan {
  const basedOn = [...new Set((meta.basedOn ?? []).map((n) => cut(n, MAX_BASED_ON_NAME)))].slice(
    0,
    MAX_BASED_ON,
  );
  const { basedOn: _ignored, ...rest } = meta;
  void _ignored;
  const extra = basedOn.length ? { basedOn } : {};
  const weeks = parseWeeks(reply);
  if (weeks)
    return { text: "", steps: [], weeks: weeks.weeks, closing: weeks.closing, ...rest, ...extra };
  const parsed = parseSteps(reply);
  return {
    text: cut(reply.trim(), MAX_TEXT),
    steps: parsed?.steps ?? [],
    closing: parsed?.closing ?? "",
    ...rest,
    ...extra,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

function parseSavedWeeks(raw: unknown): PlanWeek[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_WEEKS) return null;
  const out: PlanWeek[] = [];
  for (const w of raw) {
    if (!isObj(w) || typeof w.n !== "number" || !Number.isFinite(w.n)) return null;
    if (!isStr(w.theme, MAX_THEME) || !Array.isArray(w.activities)) return null;
    if (w.activities.length === 0 || w.activities.length > MAX_ACTIVITIES) return null;
    const acts: PlanActivity[] = [];
    for (const a of w.activities) {
      if (!isObj(a)) return null;
      if (!isStr(a.title, MAX_TITLE) || !isStr(a.what, MAX_FIELD) || !isStr(a.why, MAX_FIELD))
        return null;
      if (!isStr(a.firstStep, MAX_FIELD) || !isStr(a.often, MAX_OFTEN)) return null;
      acts.push({
        title: a.title,
        what: a.what,
        why: a.why,
        firstStep: a.firstStep,
        often: a.often,
      });
    }
    out.push({ n: w.n, theme: w.theme, activities: acts });
  }
  return out;
}

/** Checks something read from storage (or a backup file). Anything odd returns null, never a crash. */
export function parseSavedPlan(raw: unknown): SavedPlan | null {
  if (!isObj(raw)) return null;
  const { text, steps, closing, madeAt, days, sources, lowMood } = raw;
  const weeks = parseSavedWeeks(raw.weeks);
  if (raw.weeks !== undefined && weeks === null) return null;
  if (!isStr(text, MAX_TEXT) || !isStr(closing, MAX_CLOSING)) return null;
  if (!Array.isArray(steps) || steps.length > MAX_STEPS) return null;
  if (!steps.every((s) => isStr(s, MAX_STEP))) return null;
  if (typeof madeAt !== "number" || !Number.isFinite(madeAt)) return null;
  if (days !== 7 && days !== 30) return null;
  if (!isObj(sources)) return null;
  const { journal, chats, aboutMe } = sources;
  if (typeof journal !== "boolean" || typeof chats !== "boolean" || typeof aboutMe !== "boolean")
    return null;
  if (typeof lowMood !== "boolean") return null;
  if (raw.mode !== undefined && raw.mode !== "private" && raw.mode !== "cloud") return null;
  const basedOn = raw.basedOn;
  if (basedOn !== undefined) {
    if (!Array.isArray(basedOn) || basedOn.length > MAX_BASED_ON) return null;
    if (!basedOn.every((n) => isStr(n, MAX_BASED_ON_NAME))) return null;
  }
  if (!text.trim() && steps.length === 0 && !weeks?.length) return null;
  return {
    text,
    steps: steps as string[],
    ...(weeks ? { weeks } : {}),
    closing,
    madeAt,
    days,
    sources: { journal, chats, aboutMe },
    lowMood,
    ...(basedOn?.length ? { basedOn: basedOn as string[] } : {}),
    ...(raw.mode ? { mode: raw.mode } : {}),
  };
}

/** "your journal, chats and About me notes". */
export function describeSources(s: PlanSources): string {
  const parts = [s.journal && "journal", s.chats && "chats", s.aboutMe && "About me notes"].filter(
    Boolean,
  ) as string[];
  if (parts.length <= 1) return `your ${parts[0] ?? "notes"}`;
  return `your ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
