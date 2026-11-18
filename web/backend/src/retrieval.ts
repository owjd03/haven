import cardsData from "../data/copingCards.json";
import type { CopingCard } from "./types";

export const COPING_CARDS: CopingCard[] = cardsData as CopingCard[];

export interface ScoredCard {
  card: CopingCard;
  score: number;
}

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from had has have he her his i if in into is it its me my of on or our she so " +
    "that the their them then there these they this to up was we were what when where which who will with would you your " +
    "im ive am do does did not no just really very much more some about can get got been being than too also how why " +
    "feel feels feeling felt such lately keep like still even"
  ).split(" "),
);

const TAG_WEIGHT = 3;
const PHRASE_WEIGHT = 4;
const TITLE_WEIGHT = 2;
const TEXT_WEIGHT = 1;
const TEXT_CAP = 3;
const MIN_SCORE = 3;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’']/g, "") // can't -> cant (tags are normalised the same way)
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[-\s]+/g, " ")
    .trim();
}

export function tokenize(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const SUFFIXES = new Set([
  "s",
  "es",
  "ed",
  "d",
  "ing",
  "king",
  "ning",
  "ting",
  "ping",
  "er",
  "ers",
  "ly",
  "y",
  "ness",
  "ment",
  "ion",
  "ions",
]);

/**
 * Words match if equal, or if they differ only by a common ending (panic ~ panicking,
 * exam ~ exams, fail ~ failing). A plain prefix is not enough: "week" must not match "weekend".
 */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short) && SUFFIXES.has(long.slice(short.length));
}

interface Evaluation {
  score: number;
  /** Indices of message words this card accounts for. */
  used: Set<number>;
  /** How many words matched exactly (not just by prefix); used to break ties. */
  exact: number;
  /** True if a tag or phrase matched. Body-text matches alone never qualify a card. */
  strong: boolean;
}

/**
 * Scores one card against the message. Each word in the message is credited at most once,
 * so a card can't win just by listing many near-duplicate tags. Words in `exclude`
 * (already covered by a better card) are ignored.
 */
function evaluate(
  card: CopingCard,
  q: string,
  qTokens: string[],
  exclude: Set<number>,
): Evaluation {
  const used = new Set<number>(exclude);
  const mine = new Set<number>();
  let exact = 0;
  let score = 0;
  let strong = false;

  const claim = (word: string): boolean => {
    let hit = false;
    qTokens.forEach((t, i) => {
      if (used.has(i) || !tokensMatch(t, word)) return;
      used.add(i);
      mine.add(i);
      if (t === word) exact += 1;
      hit = true;
    });
    return hit;
  };

  const tags = [...new Set(card.tags.map(normalize).filter(Boolean))];

  // 1) multi-word tags matched as phrases (strongest signal)
  for (const t of tags.filter((x) => x.includes(" "))) {
    if (!q.includes(" " + t + " ")) continue;
    let credited = false;
    for (const w of tokenize(t)) credited = claim(w) || credited;
    if (credited) {
      score += PHRASE_WEIGHT;
      strong = true;
    }
  }
  // 2) single-word tags
  for (const t of tags.filter((x) => !x.includes(" "))) {
    if (claim(t)) {
      score += TAG_WEIGHT;
      strong = true;
    }
  }
  // 3) title words
  for (const w of tokenize(card.title)) {
    if (claim(w)) score += TITLE_WEIGHT;
  }
  // 4) body words (capped)
  let textHits = 0;
  for (const w of new Set(tokenize(card.text))) if (claim(w)) textHits += 1;
  score += Math.min(textHits, TEXT_CAP) * TEXT_WEIGHT;

  return { score, used: mine, exact, strong };
}

export function scoreCard(card: CopingCard, query: string): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;
  return evaluate(card, " " + normalize(query) + " ", qTokens, new Set()).score;
}

/**
 * Keyword retrieval over the coping cards. Pure and local: no network, no model.
 * Picks the best card, then the best card for the parts of the message the first one
 * didn't cover (so "panicking about my exam" gets a panic card AND an exam card).
 * Returns up to `n` cards that reach the relevance threshold.
 */
export function retrieve(query: string, n = 2, cards: CopingCard[] = COPING_CARDS): ScoredCard[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const q = " " + normalize(query) + " ";

  const picked: ScoredCard[] = [];
  const covered = new Set<number>();
  const remaining = cards.map((card) => ({ card }));

  while (picked.length < n && remaining.length > 0) {
    let best: { idx: number; ev: Evaluation } | undefined;
    remaining.forEach(({ card }, idx) => {
      const ev = evaluate(card, q, qTokens, covered);
      if (!ev.strong || ev.score < MIN_SCORE) return;
      if (
        !best ||
        ev.score > best.ev.score ||
        (ev.score === best.ev.score && ev.exact > best.ev.exact)
      ) {
        best = { idx, ev };
      }
    });
    if (!best) break;
    const [{ card }] = remaining.splice(best.idx, 1);
    best.ev.used.forEach((i) => covered.add(i));
    picked.push({ card, score: best.ev.score });
  }
  return picked;
}
