import { describe, expect, it } from "vitest";
import { SITUATIONS, detectSituations, matchPlanIdeas, type PlanIdea } from "../src";

const idea = (situation: PlanIdea["situation"], n: number, tags: string[] = []): PlanIdea => ({
  id: `${situation}-${n}`,
  situation,
  title: `${situation} idea ${n}`,
  idea: "Do a thing every week.",
  why: "It helps.",
  tags,
  source: { name: "Test", url: "https://example.org/" },
  sourceChecked: "2026-11-18",
  reviewed: false,
});
const FIXTURE: PlanIdea[] = SITUATIONS.flatMap((s) => [1, 2, 3, 4, 5, 6].map((n) => idea(s, n)));

describe("recognising the situation", () => {
  it.each([
    ["My boyfriend broke up with me and I keep thinking about my ex", "heartbreak"],
    ["my grandmother died last month and the funeral was hard", "grief"],
    ["finals are next week and the deadline for my thesis is Friday", "stress"],
    ["I moved to a new city and I feel so lonely", "loneliness"],
    ["I had a big argument with my parents and we are not speaking", "conflict"],
    ["I am completely burned out and exhausted", "burnout"],
    ["I feel flat and unmotivated, nothing feels worth it", "motivation"],
  ])("%s", (text, expected) => {
    expect(detectSituations(text)[0]?.situation).toBe(expected);
  });

  it("finds nothing in small talk", () => {
    expect(detectSituations("hi, how are you today?")).toEqual([]);
    expect(detectSituations("")).toEqual([]);
  });

  it("ranks several situations by how many signals each has", () => {
    const found = detectSituations(
      "We broke up, my ex has moved on, and I'm so lonely since I moved here",
    );
    expect(found.map((f) => f.situation)).toEqual(
      expect.arrayContaining(["heartbreak", "loneliness"]),
    );
    expect(found[0].score).toBeGreaterThanOrEqual(found[found.length - 1].score);
  });

  it("does not trigger on the letters of a word ('ex' inside 'exam')", () => {
    expect(detectSituations("I have an exam tomorrow").map((f) => f.situation)).not.toContain(
      "heartbreak",
    );
  });
});

describe("choosing ideas to ground a plan", () => {
  it("takes mostly the strongest situation, with a few from the next", () => {
    const got = matchPlanIdeas("we broke up and my ex moved on, and I feel so lonely", 8, FIXTURE);
    expect(got).toHaveLength(8);
    const by = (s: string) => got.filter((i) => i.situation === s).length;
    expect(by("heartbreak")).toBeGreaterThan(by("loneliness"));
    expect(by("loneliness")).toBeGreaterThan(0);
  });

  it("ranks ideas in a situation by how many of their tags the text mentions", () => {
    const ideas = [
      idea("heartbreak", 1, ["pottery"]),
      idea("heartbreak", 2, ["climbing", "gym"]),
      idea("heartbreak", 3, ["knitting"]),
    ];
    const got = matchPlanIdeas("we broke up and I used to love climbing at the gym", 3, ideas);
    expect(got[0].id).toBe("heartbreak-2");
  });

  it("never returns more than asked, or the same idea twice", () => {
    const got = matchPlanIdeas(
      "broke up, grief, exams, lonely, argument, burnout, flat",
      5,
      FIXTURE,
    );
    expect(got.length).toBeLessThanOrEqual(5);
    expect(new Set(got.map((i) => i.id)).size).toBe(got.length);
  });

  it("falls back to a few general routine ideas when nothing matches", () => {
    const got = matchPlanIdeas("hello there", 8, FIXTURE);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((i) => i.situation === "motivation")).toBe(true);
  });

  it("returns nothing when the library has no ideas", () => {
    expect(matchPlanIdeas("we broke up", 8, [])).toEqual([]);
  });

  it("is repeatable: the same text gives the same ideas in the same order", () => {
    const text = "broke up with my ex and feel lonely";
    expect(matchPlanIdeas(text, 6, FIXTURE).map((i) => i.id)).toEqual(
      matchPlanIdeas(text, 6, FIXTURE).map((i) => i.id),
    );
  });
});

import { PLAN_IDEAS } from "../src";

describe("the plan-ideas library data", () => {
  const words = (t: string) => t.trim().split(/\s+/).length;

  it("has ideas for every situation, at least six each", () => {
    for (const s of SITUATIONS)
      expect(PLAN_IDEAS.filter((i) => i.situation === s).length, s).toBeGreaterThanOrEqual(6);
  });

  it("draws on at least three different publishers per situation", () => {
    for (const s of SITUATIONS) {
      const names = new Set(PLAN_IDEAS.filter((i) => i.situation === s).map((i) => i.source.name));
      expect(names.size, s).toBeGreaterThanOrEqual(3);
    }
  });

  it("has unique ids that start with their situation", () => {
    expect(new Set(PLAN_IDEAS.map((i) => i.id)).size).toBe(PLAN_IDEAS.length);
    for (const i of PLAN_IDEAS) expect(i.id.startsWith(`${i.situation}-`), i.id).toBe(true);
  });

  it("gives every idea a real https source and the date it was checked", () => {
    for (const i of PLAN_IDEAS) {
      expect(i.source.name.length, i.id).toBeGreaterThan(2);
      expect(i.source.url, i.id).toMatch(/^https:\/\/[^\s]+\.[^\s]+/);
      expect(i.sourceChecked, i.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(i.reviewed, i.id).toBe(false);
    }
  });

  it("keeps ideas and reasons short, and gives each enough words to be matched", () => {
    for (const i of PLAN_IDEAS) {
      expect(words(i.idea), i.id).toBeLessThanOrEqual(45);
      expect(words(i.why), i.id).toBeLessThanOrEqual(28);
      expect(i.title.length, i.id).toBeGreaterThan(8);
      expect(i.tags.length, i.id).toBeGreaterThanOrEqual(4);
      expect(
        i.tags.every((t) => t === t.toLowerCase()),
        i.id,
      ).toBe(true);
    }
  });

  it("contains nothing clinical: no medication, therapy techniques, diagnosis, mindfulness or counselling", () => {
    const clinical =
      /\b(medicat\w*|antidepress\w*|therap\w*|cbt|diagnos\w*|treatment|mindfulness|meditat\w*|counsel\w*|doctor)\b/i;
    for (const i of PLAN_IDEAS) expect(`${i.title} ${i.idea} ${i.why}`, i.id).not.toMatch(clinical);
  });

  it("contains no goals, targets or streaks", () => {
    for (const i of PLAN_IDEAS)
      expect(`${i.title} ${i.idea} ${i.why}`, i.id).not.toMatch(
        /\b(goals?|targets?|streaks?|track(ing)?)\b/i,
      );
  });

  it("suggests nothing that depends on a shared past with someone", () => {
    for (const i of PLAN_IDEAS)
      expect(`${i.title} ${i.idea}`, i.id).not.toMatch(
        /\b(together with your|your favou?rite place|you used to do with)\b/i,
      );
  });

  it("is matched, from real notes, to the right situation", () => {
    const heart = matchPlanIdeas("we broke up and I keep thinking about my ex", 8);
    expect(heart.length).toBe(8);
    expect(heart.filter((i) => i.situation === "heartbreak").length).toBeGreaterThanOrEqual(4);
    const exams = matchPlanIdeas(
      "finals next week and the deadline for my thesis is stressing me out",
      8,
    );
    expect(exams[0].situation).toBe("stress");
    const grief = matchPlanIdeas("my dad died in the summer and the funeral was hard", 8);
    expect(grief.filter((i) => i.situation === "grief").length).toBeGreaterThanOrEqual(4);
  });
});
