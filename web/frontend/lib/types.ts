import type { NoteColor } from "@haven/backend";

export type Role = "user" | "assistant";

export interface ChatMessage {
  id?: number;
  role: Role;
  content: string;
  ts: number;
  /** True once this message has been folded into the rolling summary. */
  summarized: boolean;
  /** Where an assistant reply came from. */
  source?: "on_device" | "cloud";
  /** True when this message is an app error notice, not model output (not saved). */
  error?: boolean;
  /** True when this message is an informational app notice (not saved). */
  notice?: boolean;
}

export interface SummaryRecord {
  id?: number;
  createdAt: number;
  text: string;
  /** Highest message id covered by this summary. */
  upToMessageId: number;
}

export interface ProfileFact {
  id: string;
  text: string;
  /** "suggested" when Haven offered it and the person pressed Keep. Missing means typed by hand. */
  source?: "manual" | "suggested";
}

export interface Profile {
  facts: ProfileFact[];
}

export interface JournalEntry {
  id?: number;
  /** The day the entry is about, "YYYY-MM-DD" (local time). */
  day: string;
  /** The user's own rating, a whole number from 1 to 10. Not a measurement. */
  mood: number;
  text: string;
  createdAt: number;
  updatedAt: number;
  /** Set by the crisis check on save. Flagged entries are never sent to any model. */
  crisisFlag?: boolean;
  /** Sticky-note paper colour. Never means mood. Missing on older entries (see noteColorFor). */
  color?: NoteColor;
}
