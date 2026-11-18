import { describe, expect, it } from "vitest";
import { COPING_CARDS, retrieve, scoreCard, tokenize, type CopingCard } from "../src";

const ids = (q: string, n = 2) => retrieve(q, n).map((r) => r.card.id);

describe("coping card data", () => {
  it("has unique ids, short text, and is never marked human-reviewed by the AI", () => {
    expect(COPING_CARDS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(COPING_CARDS.map((c) => c.id)).size).toBe(COPING_CARDS.length);
    for (const c of COPING_CARDS) {
      expect(c.reviewed, c.id).toBe(false); // only a person may flip this
      expect(c.tags.length).toBeGreaterThan(2);
      expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(55); // keeps prompts short
    }
  });

  it("only claims a source check when there is a real source, and keeps TODO otherwise", () => {
    for (const c of COPING_CARDS) {
      if (c.sourceChecked) {
        expect(c.sourceChecked, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(c.source.url, c.id).toMatch(/^https:\/\//);
        expect(c.source.name, c.id).not.toMatch(/TODO/);
      } else {
        expect(c.source.name, c.id).toMatch(/TODO/);
        expect(c.source.url, c.id).toMatch(/TODO/);
      }
    }
  });
});

describe("retrieval scoring", () => {
  it("finds the right card for specific topics", () => {
    expect(ids("my boyfriend cheated on me")).toContain("partner-cheated");
    expect(ids("I filed for bankruptcy last month")).toContain("bankruptcy-not-your-worth");
    expect(ids("I had an emotional affair and feel guilty")).toContain("emotional-cheating");
    expect(ids("my best friend and I stopped talking")).toContain("friend-breakup-grief");
    expect(ids("can't sleep, mind racing")[0]).toMatch(/^sleep/);
  });

  it("matches word endings (panicking ~ panic) but not unrelated prefixes (week !~ weekend)", () => {
    expect(ids("I'm panicking")).toContain("panic-wave");
    const lonelySelf = COPING_CARDS.find((c) => c.id === "lonely-self-company")!;
    expect(scoreCard(lonelySelf, "it happened last week")).toBe(0);
  });

  it("returns nothing for chit-chat or empty input", () => {
    expect(retrieve("hi how are you")).toEqual([]);
    expect(retrieve("my dog is so cute")).toEqual([]);
    expect(retrieve("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  it("covers different parts of the message with the second card", () => {
    const r = ids("I'm panicking about my exam tomorrow");
    expect(r).toContain("panic-wave");
    expect(r.some((id) => id.startsWith("exam"))).toBe(true);
  });

  it("never returns more than n and never needs only body-text matches", () => {
    expect(retrieve("panic anxiety exam sleep", 1)).toHaveLength(1);
    const card: CopingCard = {
      id: "x",
      title: "Nothing",
      tags: ["zzz"],
      text: "alpha beta gamma delta",
      source: { name: "t", url: "t" },
      reviewed: false,
    };
    expect(retrieve("alpha beta gamma delta", 2, [card])).toEqual([]); // text-only match is not enough
  });
});
