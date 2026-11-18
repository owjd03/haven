/**
 * Privacy shield core: detect personal details, mask them with stable placeholders,
 * and un-mask the cloud reply locally. Pure functions: no network, no model.
 * The placeholder-to-original map lives in memory only and is never sent anywhere.
 */

export type EntityKind = "PERSON" | "PLACE" | "ORG" | "EMAIL" | "PHONE" | "URL" | "ITEM";
export const ENTITY_KINDS: EntityKind[] = [
  "PERSON",
  "PLACE",
  "ORG",
  "EMAIL",
  "PHONE",
  "URL",
  "ITEM",
];

export interface Entity {
  text: string;
  kind: EntityKind;
}

export type Segment =
  | { type: "text"; value: string }
  | { type: "mask"; value: string; placeholder: string; kind: EntityKind };

export interface MaskResult {
  /** The text with every masked detail replaced by a placeholder: this is all the cloud sees. */
  masked: string;
  /** The original text split into plain and masked pieces (for the preview UI). */
  segments: Segment[];
  /** placeholder -> original text, e.g. "[PERSON_1]" -> "Sam". */
  map: Record<string, string>;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']*[^\s<>"'.,;:!?)]/gi;
const PHONE_RE = /(?<![\w@.])\+?\d[\d\s().-]{6,}\d(?![\w@])/g;
const DATE_LIKE = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$|^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;

/** Rule-based detection of emails, phone numbers and links. Always available, even without the local model. */
export function detectWithRegex(text: string): Entity[] {
  const found: Entity[] = [];
  const add = (t: string, kind: EntityKind) => found.push({ text: t.trim(), kind });
  for (const m of text.matchAll(EMAIL_RE)) add(m[0], "EMAIL");
  for (const m of text.matchAll(URL_RE)) add(m[0], "URL");
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/\D/g, "").length;
    if (digits >= 7 && digits <= 15 && !DATE_LIKE.test(m[0].trim())) add(m[0], "PHONE");
  }
  return dedupeEntities(found);
}

export function dedupeEntities(entities: Entity[]): Entity[] {
  const seen = new Map<string, Entity>();
  for (const e of entities) {
    const text = e.text.trim();
    if (text.length < 2 || !/[\p{L}\p{N}]/u.test(text)) continue;
    const key = text.toLowerCase();
    if (!seen.has(key)) seen.set(key, { text, kind: e.kind });
  }
  return [...seen.values()];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace each unique detail with a stable placeholder. Only details actually present in `text` are used. */
export function applyMasks(text: string, entities: Entity[]): MaskResult {
  const list = dedupeEntities(entities).sort((a, b) => b.text.length - a.text.length);
  if (list.length === 0)
    return { masked: text, segments: [{ type: "text", value: text }], map: {} };

  const kindByKey = new Map(list.map((e) => [e.text.toLowerCase(), e.kind]));
  const alt = list.map((e) => escapeRegex(e.text)).join("|");
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alt})(?![\\p{L}\\p{N}_])`, "giu");

  const counters: Record<string, number> = {};
  const placeholderByKey = new Map<string, string>();
  const map: Record<string, string> = {};
  const segments: Segment[] = [];
  let masked = "";
  let last = 0;

  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) {
      const plain = text.slice(last, start);
      segments.push({ type: "text", value: plain });
      masked += plain;
    }
    const key = m[0].toLowerCase();
    const kind = kindByKey.get(key) ?? "ITEM";
    let placeholder = placeholderByKey.get(key);
    if (!placeholder) {
      counters[kind] = (counters[kind] ?? 0) + 1;
      placeholder = `[${kind}_${counters[kind]}]`;
      placeholderByKey.set(key, placeholder);
      map[placeholder] = m[0];
    }
    segments.push({ type: "mask", value: m[0], placeholder, kind });
    masked += placeholder;
    last = start + m[0].length;
  }
  if (last < text.length) {
    const tail = text.slice(last);
    segments.push({ type: "text", value: tail });
    masked += tail;
  }
  return { masked, segments, map };
}

const KINDS = ENTITY_KINDS.join("|");
const PLACEHOLDER_RE = new RegExp(
  `\\[\\s*(${KINDS})[\\s_-]*(\\d+)\\s*\\]|\\b(${KINDS})_(\\d+)\\b`,
  "gi",
);
const PRIVATE_FALLBACK = "(a private detail)";

export interface UnmaskResult {
  text: string;
  /** True if the reply contained a placeholder we couldn't restore (it was left generic). */
  altered: boolean;
  /** Placeholders from the map that never appeared in the reply (informational). */
  missing: string[];
}

/**
 * Restore originals in a cloud reply. Tolerates small formatting changes ("[person 1]", "PERSON_1").
 * Unknown placeholders are replaced with a neutral phrase instead of failing.
 */
export function unmask(reply: string, map: Record<string, string>): UnmaskResult {
  const used = new Set<string>();
  let altered = false;
  const text = reply.replace(
    PLACEHOLDER_RE,
    (
      _m,
      k1: string | undefined,
      n1: string | undefined,
      k2: string | undefined,
      n2: string | undefined,
    ) => {
      const key = `[${(k1 ?? k2 ?? "").toUpperCase()}_${n1 ?? n2}]`;
      if (key in map) {
        used.add(key);
        return map[key];
      }
      altered = true;
      return PRIVATE_FALLBACK;
    },
  );
  return { text, altered, missing: Object.keys(map).filter((k) => !used.has(k)) };
}

/**
 * While a reply is still arriving, a placeholder may be only half written ("... told [PERS"). Showing
 * that would flash odd text, so this cuts a trailing, unfinished placeholder off the text for display.
 * Complete placeholders are left alone, and so is anything else. The finished reply is un-masked in full.
 */
export function holdBackPartial(text: string): string {
  // "[" followed by a few letters/underscore/space/digits and no closing bracket, at the very end.
  const bracketed = /\[[A-Za-z]{0,10}[ _]?\d{0,4}$/.exec(text);
  if (bracketed) return text.slice(0, bracketed.index);
  // The unbracketed form some models write, e.g. "PERSON_" or "PLACE_1" still arriving.
  const bare = new RegExp(`(?:^|[^A-Za-z0-9_])((?:${KINDS})_\\d{0,4})$`).exec(text);
  if (bare) return text.slice(0, text.length - bare[1].length);
  return text;
}

/** The reply so far with originals restored, and nothing half-finished showing. For streaming display. */
export function unmaskPartial(textSoFar: string, map: Record<string, string>): string {
  return unmask(holdBackPartial(textSoFar), map).text;
}
