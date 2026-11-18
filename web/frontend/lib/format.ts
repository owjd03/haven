/**
 * The small on-device model doesn't always follow the writing rules in its instruction. These
 * plain-code fixes catch the slips we have seen, so the reply reads the way Haven intends.
 */

const PET_NAMES = "honey|sweetie|sweetheart|hun|babe|darling";

/**
 * Removes slips the model makes in the words themselves:
 * - a speaker label it copied from the prompt ("Haven: ..."), possibly repeated,
 * - pet names ("Oh honey, ...", "..., sweetie,"),
 * - an "Oh" opener.
 * Used before a reply is saved (so a label never re-enters later prompts) and again for display
 * (so replies saved before this fix also look right).
 */
export function cleanReply(text: string): string {
  // Openers first: "Haven: Oh honey, that..." becomes "that...".
  const start = text.trim();
  let t = start
    .replace(/^(\s*(haven|assistant|ai)\s*:\s*)+/i, "") // copied speaker label, maybe repeated
    .replace(new RegExp(`^(oh,?\\s+)?(${PET_NAMES}|dear)\\b[,.!]?\\s*`, "i"), "") // "Oh honey, "
    .replace(/^oh\b[,.!]?\s*/i, ""); // "Oh, "
  // Re-capitalize only when an opener was removed, so normal replies stay exactly as written.
  if (t !== start) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t
    .replace(new RegExp(`,\\s*(${PET_NAMES}|dear)\\b(?=[,.!?])`, "gi"), "") // "..., sweetie."
    .replace(new RegExp(`\\b(${PET_NAMES})\\b,?\\s*`, "gi"), ""); // any left mid-sentence
}

/**
 * The model also sometimes writes Markdown (*emphasis*, **bold**, # headings, "* " bullets)
 * even when told not to. Haven shows plain text, so this removes the markers for display.
 */
export function plainText(text: string): string {
  return cleanReply(text)
    .replace(/^[ \t]*[*-][ \t]+/gm, "• ") // "* item" and "- item" lines become bullets
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "") // "## Heading" becomes "Heading"
    .replace(/\*\*([^*\n]+)\*\*/g, "$1") // **bold**
    .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, "$1"); // *emphasis*
}

/** The most sentences a reply may have in each mode. Matches the numbers in the instruction. */
export const MAX_SENTENCES = { listen: 4, help: 6 } as const;

const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|st)\./gi;
const HOLD = "\u0000";

/** Splits into sentences without breaking on "e.g.", "Dr." or decimals like "3.5". */
export function splitSentences(text: string): string[] {
  const held = text
    .replace(ABBREVIATIONS, (m) => m.replace(/\./g, HOLD))
    .replace(/(\d)\.(\d)/g, `$1${HOLD}$2`);
  return held
    .split(/(?<=[.!?])["')\]]*\s+/)
    .map((s) => s.split(HOLD).join(".").trim())
    .filter(Boolean);
}

/**
 * If a reply runs over `max` sentences, cut from the middle: keep the opening (the reflection) and,
 * when the reply ends with a question, that closing question. Replies within the limit are untouched.
 */
export function capSentences(text: string, max: number): string {
  const sentences = splitSentences(text);
  if (sentences.length <= max) return text;
  const last = sentences[sentences.length - 1];
  const keepLast = max > 1 && last.endsWith("?");
  const head = sentences.slice(0, keepLast ? max - 1 : max);
  return (keepLast ? [...head, last] : head).join(" ");
}

/** Everything a finished reply goes through before it is saved, whichever model wrote it. */
export function finishReply(text: string, mode: keyof typeof MAX_SENTENCES): string {
  return capSentences(cleanReply(text), MAX_SENTENCES[mode]);
}
