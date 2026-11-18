/** Backup file format for "Download my data" / "Restore from file", with strict validation. */

export const BACKUP_VERSION = 3;
const MAX_MESSAGES = 50_000;
const MAX_TEXT = 20_000;
const MAX_JOURNAL = 20_000;
export const MAX_JOURNAL_TEXT = 10_000;
/** Longest value a single saved setting may have. Small steps keeps a 4-week plan here, up to about 12,000 characters. */
export const MAX_SETTING = 20_000;

/** The sticky-note paper colours a journal entry can have. Colour never encodes mood. */
export const NOTE_COLORS = ["butter", "peach", "sage", "sky", "lilac"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const isNoteColor = (v: unknown): v is NoteColor =>
  typeof v === "string" && (NOTE_COLORS as readonly string[]).includes(v);

export interface BackupMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  ts: number;
  summarized: boolean;
  source?: "on_device" | "cloud";
}
export interface BackupSummary {
  id?: number;
  createdAt: number;
  text: string;
  upToMessageId: number;
}
export interface BackupJournal {
  id?: number;
  /** The day the entry is about, "YYYY-MM-DD". */
  day: string;
  /** The user's own rating, a whole number from 1 to 10. */
  mood: number;
  text: string;
  createdAt: number;
  updatedAt: number;
  /** Set when the entry contained crisis language; such entries are never sent to any AI. */
  crisisFlag?: boolean;
  /** Paper colour of the sticky note. Optional: older entries get one from a fixed rotation. */
  color?: NoteColor;
}
export interface BackupFact {
  id: string;
  text: string;
  /** Added in backup version 3. Missing means the person typed it themselves. */
  source?: "manual" | "suggested";
}
export interface HavenBackup {
  app: "haven";
  version: number;
  exportedAt: string;
  profile: { facts: BackupFact[] };
  messages: BackupMessage[];
  summaries: BackupSummary[];
  /** Added in backup version 2; version 1 files have none. */
  journal: BackupJournal[];
  settings: Record<string, string>;
}

export type ValidationResult = { ok: true; backup: HavenBackup } | { ok: false; errors: string[] };

export function buildBackup(parts: {
  facts: BackupFact[];
  messages: BackupMessage[];
  summaries: BackupSummary[];
  journal?: BackupJournal[];
  settings: Record<string, string>;
}): HavenBackup {
  return {
    app: "haven",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profile: { facts: parts.facts },
    messages: parts.messages,
    summaries: parts.summaries,
    journal: parts.journal ?? [],
    settings: parts.settings,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.length <= max;

/** True for a real calendar day written as YYYY-MM-DD (rejects 2026-02-31 and the like). */
export function isRealDay(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Validates untrusted JSON and returns a cleaned copy (unknown fields dropped). */
export function validateBackup(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["This file isn't a Haven backup."] };
  if (raw.app !== "haven") errors.push('Missing marker: app must be "haven".');
  if (!isNum(raw.version) || raw.version < 1 || raw.version > BACKUP_VERSION) {
    errors.push(`Unsupported backup version (this Haven reads versions 1 to ${BACKUP_VERSION}).`);
  }

  const facts: BackupFact[] = [];
  const profile = raw.profile;
  if (!isObj(profile) || !Array.isArray(profile.facts))
    errors.push("Profile notes are missing or malformed.");
  else
    profile.facts.forEach((f, i) => {
      if (
        isObj(f) &&
        isStr(f.id, 100) &&
        isStr(f.text, 500) &&
        (f.source === undefined || f.source === "manual" || f.source === "suggested")
      )
        facts.push({ id: f.id, text: f.text, ...(f.source ? { source: f.source } : {}) });
      else errors.push(`Profile note #${i + 1} is invalid.`);
    });

  const messages: BackupMessage[] = [];
  if (!Array.isArray(raw.messages)) errors.push("Messages are missing or malformed.");
  else if (raw.messages.length > MAX_MESSAGES) errors.push("Too many messages in this file.");
  else
    raw.messages.forEach((m, i) => {
      if (
        isObj(m) &&
        (m.role === "user" || m.role === "assistant") &&
        isStr(m.content) &&
        isNum(m.ts) &&
        typeof m.summarized === "boolean" &&
        (m.id === undefined || isNum(m.id)) &&
        (m.source === undefined || m.source === "on_device" || m.source === "cloud")
      ) {
        const clean: BackupMessage = {
          role: m.role,
          content: m.content,
          ts: m.ts,
          summarized: m.summarized,
        };
        if (isNum(m.id)) clean.id = m.id;
        if (m.source) clean.source = m.source;
        messages.push(clean);
      } else if (errors.length < 10) errors.push(`Message #${i + 1} is invalid.`);
    });

  const summaries: BackupSummary[] = [];
  if (!Array.isArray(raw.summaries)) errors.push("Summaries are missing or malformed.");
  else
    raw.summaries.forEach((s, i) => {
      if (
        isObj(s) &&
        isNum(s.createdAt) &&
        isStr(s.text) &&
        isNum(s.upToMessageId) &&
        (s.id === undefined || isNum(s.id))
      ) {
        const clean: BackupSummary = {
          createdAt: s.createdAt,
          text: s.text,
          upToMessageId: s.upToMessageId,
        };
        if (isNum(s.id)) clean.id = s.id;
        summaries.push(clean);
      } else if (errors.length < 10) errors.push(`Summary #${i + 1} is invalid.`);
    });

  const journal: BackupJournal[] = [];
  if (raw.journal !== undefined) {
    if (!Array.isArray(raw.journal)) errors.push("Journal entries are malformed.");
    else if (raw.journal.length > MAX_JOURNAL)
      errors.push("Too many journal entries in this file.");
    else
      raw.journal.forEach((j, i) => {
        if (
          isObj(j) &&
          isRealDay(j.day) &&
          isNum(j.mood) &&
          Number.isInteger(j.mood) &&
          j.mood >= 1 &&
          j.mood <= 10 &&
          isStr(j.text, MAX_JOURNAL_TEXT) &&
          isNum(j.createdAt) &&
          isNum(j.updatedAt) &&
          (j.id === undefined || isNum(j.id)) &&
          (j.crisisFlag === undefined || typeof j.crisisFlag === "boolean") &&
          (j.color === undefined || isNoteColor(j.color))
        ) {
          const clean: BackupJournal = {
            day: j.day,
            mood: j.mood,
            text: j.text,
            createdAt: j.createdAt,
            updatedAt: j.updatedAt,
          };
          if (isNum(j.id)) clean.id = j.id;
          if (j.crisisFlag) clean.crisisFlag = true;
          if (j.color !== undefined) clean.color = j.color;
          journal.push(clean);
        } else if (errors.length < 10) errors.push(`Journal entry #${i + 1} is invalid.`);
      });
  }

  const settings: Record<string, string> = {};
  if (!isObj(raw.settings)) errors.push("Settings are missing or malformed.");
  else
    for (const [k, v] of Object.entries(raw.settings)) {
      if (/^[a-zA-Z][\w.-]{0,40}$/.test(k) && isStr(v, MAX_SETTING)) settings[k] = v;
      else errors.push(`Setting "${k}" is invalid.`);
    }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    backup: {
      app: "haven",
      version: raw.version as number,
      exportedAt: isStr(raw.exportedAt, 100) ? raw.exportedAt : new Date(0).toISOString(),
      profile: { facts },
      messages,
      summaries,
      journal,
      settings,
    },
  };
}
