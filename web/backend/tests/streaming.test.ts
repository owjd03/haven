import { describe, expect, it } from "vitest";
import { holdBackPartial, unmask, unmaskPartial } from "../src";

const MAP = { "[PERSON_1]": "Maya", "[PLACE_1]": "Toronto" };

describe("showing a reply while it is still arriving", () => {
  it("holds back a placeholder that is only half written", () => {
    for (const [soFar, shown] of [
      ["Talk to [", "Talk to "],
      ["Talk to [PER", "Talk to "],
      ["Talk to [PERSON", "Talk to "],
      ["Talk to [PERSON_", "Talk to "],
      ["Talk to [PERSON_1", "Talk to "],
      ["Talk to [person 1", "Talk to "],
      ["Walk in PLACE_", "Walk in "],
      ["Walk in PLACE_12", "Walk in "],
    ])
      expect(holdBackPartial(soFar), soFar).toBe(shown);
  });

  it("leaves complete placeholders and ordinary text alone", () => {
    for (const t of [
      "",
      "Hello there",
      "Talk to [PERSON_1]",
      "Talk to [PERSON_1] and [PLACE_1].",
      "A sentence that ends in words.",
      "See the NOTE_ section",
      "Item 1.",
    ])
      expect(holdBackPartial(t), t).toBe(t);
  });

  it("restores originals as soon as a placeholder is complete", () => {
    expect(unmaskPartial("Talk to [PERSON_1]", MAP)).toBe("Talk to Maya");
    expect(unmaskPartial("Talk to [PERSON_1] in [PLACE_", MAP)).toBe("Talk to Maya in ");
    expect(unmaskPartial("Talk to [PERSON_1] in [PLACE_1] soon", MAP)).toBe(
      "Talk to Maya in Toronto soon",
    );
  });

  it("never shows a half-written placeholder at any point while a reply streams in", () => {
    const reply = "Call [PERSON_1] this week, and visit [PLACE_1] for a walk.";
    for (let i = 0; i <= reply.length; i++) {
      const shown = unmaskPartial(reply.slice(0, i), MAP);
      expect(shown, reply.slice(0, i)).not.toMatch(/\[|PERSON_|PLACE_/);
    }
  });

  it("only ever grows as more arrives, apart from the held-back tail", () => {
    const reply = "Call [PERSON_1] this week, and visit [PLACE_1] for a walk.";
    let prev = "";
    for (let i = 0; i <= reply.length; i++) {
      const shown = unmaskPartial(reply.slice(0, i), MAP);
      expect(shown.length).toBeGreaterThanOrEqual(prev.length);
      prev = shown;
    }
    expect(prev).toBe(unmask(reply, MAP).text);
  });
});
