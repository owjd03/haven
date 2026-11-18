"use client";

import {
  detectCrisis,
  isRealDay,
  MAX_JOURNAL_TEXT,
  NOTE_COLORS,
  type NoteColor,
} from "@haven/backend";
import type { JournalEntry } from "./types";

// Gathering entries for the cloud lives in ./insights.

// ---------- days (all local time, written as "YYYY-MM-DD") ----------

const pad = (n: number) => String(n).padStart(2, "0");

export function localDayKey(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The day `delta` calendar days from `key` (negative goes back), safe across daylight saving. */
export function shiftDay(key: string, delta: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + delta);
  return localDayKey(d.getTime());
}

/** Local midnight at the start of a day, as a timestamp. */
export function dayStart(key: string): number {
  return parseDay(key).getTime();
}

export function formatDay(key: string): string {
  return parseDay(key).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

// ---------- entry checks ----------

export interface EntryInput {
  day: string;
  mood: number | null;
  text: string;
}

/** A plain-language problem with the entry, or null if it can be saved. */
export function validateEntry(input: EntryInput, today = localDayKey()): string | null {
  if (!isRealDay(input.day)) return "Please choose a valid day.";
  if (input.day > today)
    return "That day hasn't happened yet. Please pick today or an earlier day.";
  if (input.mood === null || !Number.isInteger(input.mood) || input.mood < 1 || input.mood > 10)
    return "Please choose how you're feeling, from 1 to 10.";
  const text = input.text.trim();
  if (!text) return "Write a little about how you're feeling first.";
  if (text.length > MAX_JOURNAL_TEXT)
    return `That's a bit long. Please keep it under ${MAX_JOURNAL_TEXT.toLocaleString()} characters.`;
  return null;
}

/** Same plain-code safety rule as chat: crisis language is never sent to any model. */
export function isCrisisText(text: string): boolean {
  return detectCrisis(text).matched;
}

/** An entry may go to the cloud only if it was never flagged AND still passes the check now. */
export function isSendable(e: Pick<JournalEntry, "text" | "crisisFlag">): boolean {
  return !e.crisisFlag && !isCrisisText(e.text);
}

// ---------- sticky notes ----------

/** The note's colour: the one saved with it, or a fixed rotation by id for older entries. */
export function noteColorFor(e: Pick<JournalEntry, "id" | "color">): NoteColor {
  return e.color ?? NOTE_COLORS[Math.abs(e.id ?? 0) % NOTE_COLORS.length];
}

/** A small fixed tilt per note, in degrees (never more than 1.5), so notes don't jump between renders. */
const TILTS = [-1.5, 0.8, -0.6, 1.2, -1, 1.5, -0.3, 0.5];
export function tiltFor(id: number | undefined): number {
  return TILTS[Math.abs(id ?? 0) % TILTS.length];
}

/** The colour a new note starts with: rotates through the palette as the board grows. */
export function defaultNoteColor(noteCount: number): NoteColor {
  return NOTE_COLORS[noteCount % NOTE_COLORS.length];
}
