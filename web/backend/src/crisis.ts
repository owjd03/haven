/**
 * Rule-based crisis check. Plain code, NOT AI. Runs before ANY model call.
 * It is deliberately broad: a false alarm shows a support screen, a miss could hurt someone.
 */

export interface CrisisResult {
  matched: boolean;
  /** The pattern sources that matched (for tests/debugging; never sent anywhere). */
  matches: string[];
}

// Each pattern is tested against normalised text (lowercase, apostrophes removed, punctuation -> space).
const PATTERNS: RegExp[] = [
  // Direct suicide language
  /\bsuicid(e|al)\b/,
  /\bkill(ing)? my ?self\b/,
  /\bkms\b/,
  /\bend(ing)? my (own )?life\b/,
  /\btake my (own )?life\b/,
  /\btaking my (own )?life\b/,
  /\bend(ing)? it all\b/,
  /\bend(ing)? everything\b/,
  /\bend (it|things) for good\b/,
  /\bwant(ed)? to die\b/,
  /\bwanna die\b/,
  /\bwish (i|id|i was|i were|i could) (was |were |be )?(dead|die)\b/,
  /\bwish i (was|were) (never born|not alive|dead)\b/,
  /\bwish i (wasnt|werent) (alive|here|born)\b/,
  /\b(better|rather) (off )?(be )?dead\b/,
  /\bbetter off dead\b/,
  /\bwould be better off without me\b/,
  /\bworld (would be|is) better (off )?without me\b/,
  /\bnobody would (even )?(miss|notice|care)( me)?\b/,
  /\bno one would (even )?(miss|notice|care)( about me)?\b/,
  /\bdont want to (live|be alive|exist|wake up)\b/,
  /\bdo not want to (live|be alive|exist|wake up)\b/,
  /\bdont want to be (here|alive|around) (any ?more|any longer)\b/,
  /\bdo not want to be (here|alive|around) (any ?more|any longer)\b/,
  /\bdont want to be here\b/,
  /\bno (point|reason) (in|to) (living|live|going on|being alive|being here|exist(ing)?)\b/,
  /\bno (point|reason) (in )?(life|living)\b/,
  /\b(cant|cannot|can not) (go on|do this any ?more|take it any ?more|keep going)\b/,
  /\bnot (want to )?be alive\b/,
  /\bgive up on life\b/,
  /\bdont see (a|any) (way|point) (out|in living|in going on)\b/,
  /\bno way out\b/,
  /\b(disappear|vanish) (forever|for good)\b/,
  /\bsleep (forever|and never wake up)\b/,
  /\bnever wake up\b/,
  /\bstop existing\b/,
  /\bdont want to exist\b/,
  // Methods / intent
  /\b(hang|drown|shoot|poison) my ?self\b/,
  /\bjump (off|from) (a |the )?(bridge|building|roof|cliff|balcony)\b/,
  /\boverdos(e|ing)\b/,
  /\bslit my (wrists?|throat)\b/,
  /\bswallow(ing)? (all )?(the |my )?(pills|tablets)\b/,
  /\bplan(ning)? to (die|kill myself|end it)\b/,
  /\bwrite (a |my )?(suicide )?note\b/,
  /\bgoodbye (note|letter)\b/,
  // Self-harm
  /\bself ?harm(ing)?\b/,
  /\bhurt(ing)? my ?self\b/,
  /\bharm(ing)? my ?self\b/,
  /\bcut(ting)? my ?self\b/,
  /\bcut(ting)? my (wrists?|arms?|legs?)\b/,
  /\bburn(ing)? my ?self\b/,
  /\bpunish my ?self (physically|by hurting)\b/,
];

export function normalizeForCrisis(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛`']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectCrisis(text: string): CrisisResult {
  const t = " " + normalizeForCrisis(text) + " ";
  const matches = PATTERNS.filter((p) => p.test(t)).map((p) => p.source);
  return { matched: matches.length > 0, matches };
}

export function isCrisis(text: string): boolean {
  return detectCrisis(text).matched;
}
