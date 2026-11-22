/**
 * The reading list: a few trusted public pages for each situation, shown as "Read more" links at the
 * end of a Small steps plan. Links and titles only, no article text is copied. Every page was opened
 * and read before it was added, and the date is saved. Nothing here is medical advice, and the pages
 * have not been reviewed by a clinician.
 */
import readingData from "../data/readingLinks.json";
import type { PlanIdea, Situation } from "./planIdeas";

export interface ReadingLink {
  id: string;
  situation: Situation;
  /** The page's own title, shortened. */
  title: string;
  publisher: string;
  url: string;
  /** Date (YYYY-MM-DD) when the page was opened and checked against its title. */
  checked: string;
}

export const READING_LINKS: ReadingLink[] = readingData as ReadingLink[];

/** The most links a plan shows. */
export const MAX_READING = 5;

/** Only plain web addresses are ever shown as links. */
export const isHttpsUrl = (url: string): boolean => /^https:\/\/[^\s]+$/i.test(url);

/**
 * Picks links for the given situations, most relevant situation first, one from each in turn so a plan
 * about two situations gets some of both. No repeats, at most `max`.
 */
export function readingFor(
  situations: readonly Situation[],
  max: number = MAX_READING,
  links: readonly ReadingLink[] = READING_LINKS,
): ReadingLink[] {
  const lists = [...new Set(situations)].map((s) => links.filter((l) => l.situation === s));
  const picked: ReadingLink[] = [];
  for (let round = 0; picked.length < max; round++) {
    let added = false;
    for (const list of lists) {
      const link = list[round];
      if (link && picked.length < max && !picked.some((p) => p.id === link.id)) {
        picked.push(link);
        added = true;
      }
    }
    if (!added) break;
  }
  return picked;
}

/** Reading links for the ideas a plan was written from: the situations that came up most go first. */
export function readingForIdeas(
  ideas: readonly PlanIdea[],
  max: number = MAX_READING,
): ReadingLink[] {
  const counts = new Map<Situation, number>();
  for (const i of ideas) counts.set(i.situation, (counts.get(i.situation) ?? 0) + 1);
  const order = [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  return readingFor(order, max);
}

/**
 * Turns saved ids back into links. Only ids that are in the library count, so saved or imported data
 * can never put an unknown address on screen. Repeats are dropped and the list is capped.
 */
export function resolveReading(
  ids: readonly unknown[] | undefined,
  links: readonly ReadingLink[] = READING_LINKS,
): ReadingLink[] {
  const picked: ReadingLink[] = [];
  for (const id of ids ?? []) {
    const link = typeof id === "string" ? links.find((l) => l.id === id) : undefined;
    if (link && !picked.some((p) => p.id === link.id) && isHttpsUrl(link.url)) picked.push(link);
    if (picked.length >= MAX_READING) break;
  }
  return picked;
}
