"use client";

import {
  dedupeEntities,
  detectWithRegex,
  unmask,
  unmaskPartial,
  type Entity,
  type UnmaskResult,
} from "@haven/backend";
import { cloudGenerate, cloudGenerateStream, detectEntities } from "./ai";

export interface ShieldPrep {
  original: string;
  /** Detected personal details (regex always; the on-device model when available). */
  entries: Entity[];
  /** True when only rule-based detection ran, so detection is weaker. */
  weak: boolean;
}

/**
 * Step 2 of the shield: find personal details. Regex first (emails, phones, links), then the
 * on-device model for names, places, organizations and schools. Nothing leaves the device here.
 */
export async function prepareShield(text: string, localReady: boolean): Promise<ShieldPrep> {
  const entries: Entity[] = [...detectWithRegex(text)];
  let weak = true;
  if (localReady) {
    try {
      const d = await detectEntities(text);
      d.people.forEach((t) => entries.push({ text: t, kind: "PERSON" }));
      d.places.forEach((t) => entries.push({ text: t, kind: "PLACE" }));
      d.organizations.forEach((t) => entries.push({ text: t, kind: "ORG" }));
      weak = false;
    } catch {
      weak = true; // fall back to regex-only and warn the user
    }
  }
  return { original: text, entries: dedupeEntities(entries), weak };
}

export const PLACEHOLDER_RULE =
  "Some details in the text below were replaced by placeholders like [PERSON_1], [PLACE_1] or [ORG_1]. " +
  "Keep each placeholder exactly as written, and never guess what it stands for.";

/**
 * Step 5 and 6: send ONLY the masked text, then restore originals locally.
 * Callers must have shown the preview and received confirmation first.
 */
export async function sendMasked(
  masked: string,
  map: Record<string, string>,
  instruction: string,
  /** If given, the reply streams in: this receives the text so far, with originals restored. */
  onPartial?: (unmaskedSoFar: string) => void,
): Promise<UnmaskResult> {
  const prompt = `${instruction}\n\n${PLACEHOLDER_RULE}\n\n---\n${masked}\n---`;
  const { text } = onPartial
    ? await cloudGenerateStream(prompt, (soFar) => onPartial(unmaskPartial(soFar, map)))
    : await cloudGenerate(prompt);
  return unmask(text, map);
}
