/**
 * The plan-ideas library: longer-term, concrete activity ideas for common situations, each taken from
 * credible public guidance with its source saved (like the coping cards). Small steps matches the
 * right ones on the device and gives them to the cloud model as grounding. Only this generic library
 * text is ever sent: the words used to match stay on the device.
 */
import ideasData from "../data/planIdeas.json";
import { tokenize } from "./retrieval";

export const SITUATIONS = [
  "heartbreak",
  "grief",
  "stress",
  "loneliness",
  "conflict",
  "burnout",
  "motivation",
] as const;
export type Situation = (typeof SITUATIONS)[number];

export interface PlanIdea {
  id: string;
  situation: Situation;
  title: string;
  /** The concrete, longer-term activity. */
  idea: string;
  /** Why it helps, as the source says it. */
  why: string;
  /** Words a person might use about the situation or the activity. */
  tags: string[];
  source: { name: string; url: string };
  /** Date (YYYY-MM-DD) when the cited page was opened and its advice compared with this idea. */
  sourceChecked: string;
  /** Written from published guidance, not yet reviewed by a clinician. Only a person may set true. */
  reviewed: false;
}

export const PLAN_IDEAS: PlanIdea[] = ideasData as PlanIdea[];

/** Words and phrases that suggest each situation. Lowercase; matched as whole words or phrases. */
const SIGNALS: Record<Situation, string[]> = {
  heartbreak: [
    "breakup",
    "break up",
    "broke up",
    "breaking up",
    "broken up",
    "my ex",
    "ex",
    "heartbroken",
    "heartbreak",
    "dumped",
    "divorce",
    "divorced",
    "separated",
    "separation",
    "cheated",
    "cheating",
    "relationship ended",
    "relationship is over",
    "girlfriend",
    "boyfriend",
    "partner left",
    "moved on",
  ],
  grief: [
    "died",
    "death",
    "dead",
    "passed away",
    "funeral",
    "grief",
    "grieving",
    "bereaved",
    "bereavement",
    "mourning",
    "lost my",
    "loss of",
    "miss them",
    "terminal",
  ],
  stress: [
    "exam",
    "exams",
    "finals",
    "midterm",
    "midterms",
    "deadline",
    "deadlines",
    "studying",
    "assignment",
    "assignments",
    "coursework",
    "thesis",
    "dissertation",
    "workload",
    "interview",
    "boss",
    "overwhelmed",
    "pressure",
    "behind on",
    "grades",
  ],
  loneliness: [
    "lonely",
    "loneliness",
    "alone",
    "isolated",
    "isolation",
    "no friends",
    "homesick",
    "moved",
    "moving",
    "new city",
    "new country",
    "new school",
    "nobody",
    "left out",
    "friendless",
  ],
  conflict: [
    "argument",
    "argue",
    "argued",
    "arguing",
    "fight",
    "fought",
    "fell out",
    "falling out",
    "fallout",
    "not speaking",
    "stopped talking",
    "parents",
    "mom",
    "dad",
    "mother",
    "father",
    "sibling",
    "brother",
    "sister",
    "roommate",
    "flatmate",
    "betrayed",
    "friend upset",
  ],
  burnout: [
    "burnout",
    "burned out",
    "burnt out",
    "exhausted",
    "exhaustion",
    "drained",
    "no energy",
    "worn out",
    "overworked",
    "running on empty",
  ],
  motivation: [
    "unmotivated",
    "motivation",
    "cant be bothered",
    "cannot be bothered",
    "flat",
    "stuck",
    "numb",
    "pointless",
    "no interest",
    "nothing to look forward",
    "lost interest",
    "empty",
    "depressed",
    "low mood",
    "no point",
  ],
};

function normalise(s: string): string {
  return ` ${s
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

export interface SituationScore {
  situation: Situation;
  score: number;
}

/** Which situations the text points to, strongest first. Each distinct signal counts once. */
export function detectSituations(text: string): SituationScore[] {
  const t = normalise(text);
  const scores: SituationScore[] = [];
  for (const situation of SITUATIONS) {
    let score = 0;
    for (const signal of SIGNALS[situation]) if (t.includes(` ${signal} `)) score++;
    if (score > 0) scores.push({ situation, score });
  }
  return scores.sort((a, b) => b.score - a.score);
}

/**
 * The best-matching ideas for some text (the person's notes and answers, read on the device).
 * Takes the strongest situation first, then a few from the next, ranked by how many of their tags
 * appear in the text. If nothing clearly matches, returns a few general routine ideas.
 */
export function matchPlanIdeas(
  text: string,
  limit = 8,
  ideas: PlanIdea[] = PLAN_IDEAS,
): PlanIdea[] {
  const tokens = new Set(tokenize(text));
  const tagScore = (i: PlanIdea) =>
    i.tags.reduce((n, tag) => n + (tokenize(tag).every((w) => tokens.has(w)) ? 1 : 0), 0);
  const rank = (list: PlanIdea[]) =>
    [...list].sort((a, b) => tagScore(b) - tagScore(a) || a.id.localeCompare(b.id));

  const found = detectSituations(text);
  const picked: PlanIdea[] = [];
  const take = (situation: Situation, max: number) => {
    for (const i of rank(ideas.filter((x) => x.situation === situation))) {
      if (picked.length >= limit || max <= 0) break;
      if (picked.some((p) => p.id === i.id)) continue;
      picked.push(i);
      max--;
    }
  };
  if (found.length === 0) {
    take("motivation", Math.min(limit, 5));
    return picked;
  }
  take(found[0].situation, Math.ceil(limit * 0.6));
  if (found[1]) take(found[1].situation, Math.floor(limit * 0.3));
  if (found[2]) take(found[2].situation, limit - picked.length);
  // Fill any slots left over (a situation had few ideas, or the shares didn't add up to the limit).
  for (const f of found) take(f.situation, limit - picked.length);
  return picked.slice(0, limit);
}
