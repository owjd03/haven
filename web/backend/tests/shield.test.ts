import { describe, expect, it } from "vitest";
import { applyMasks, detectWithRegex, unmask, type Entity } from "../src";

const TEXT =
  "Hi, I'm Sam from Oakridge High in Boston. Email sam.k@school.edu or call +1 (415) 555-0132. " +
  "See https://example.com/page. My friend Priya said Sam should rest. Date 2024-05-10.";
const MODEL: Entity[] = [
  { text: "Sam", kind: "PERSON" },
  { text: "Priya", kind: "PERSON" },
  { text: "Oakridge High", kind: "ORG" },
  { text: "Boston", kind: "PLACE" },
];

describe("regex detection", () => {
  it("finds emails, phones and links, but not dates", () => {
    const found = detectWithRegex(TEXT);
    expect(found).toContainEqual({ text: "sam.k@school.edu", kind: "EMAIL" });
    expect(found).toContainEqual({ text: "https://example.com/page", kind: "URL" });
    expect(found.some((e) => e.kind === "PHONE" && e.text.includes("555"))).toBe(true);
    expect(found.some((e) => e.text.includes("2024-05-10"))).toBe(false);
  });
});

describe("masking", () => {
  const r = applyMasks(TEXT, [...detectWithRegex(TEXT), ...MODEL]);

  it("replaces each unique detail with a stable placeholder", () => {
    expect(r.masked).toContain("[PERSON_1]");
    expect(r.masked).toContain("[PERSON_2]");
    expect(r.masked.match(/\[PERSON_1\]/g)).toHaveLength(2); // Sam appears twice, same placeholder
    expect(r.masked).toContain("[ORG_1]");
    expect(r.masked).toContain("[PLACE_1]");
    expect(r.masked).toContain("[EMAIL_1]");
    expect(r.masked).toContain("[PHONE_1]");
    expect(r.masked).toContain("[URL_1]");
  });

  it("never leaks a masked original into the masked text", () => {
    for (const secret of [
      "Sam",
      "Priya",
      "Oakridge",
      "Boston",
      "sam.k@school.edu",
      "555-0132",
      "example.com",
    ]) {
      expect(r.masked).not.toContain(secret);
    }
  });

  it("round-trips: unmask(masked) restores the original text exactly", () => {
    expect(unmask(r.masked, r.map).text).toBe(TEXT);
  });

  it("does not mask partial words and supports manual masks", () => {
    const m = applyMasks("Samuel met Sam", [{ text: "Sam", kind: "ITEM" }]);
    expect(m.masked).toBe("Samuel met [ITEM_1]");
  });

  it("prefers longer matches (New York over York) and handles no entities", () => {
    const m = applyMasks("I moved to New York", [
      { text: "York", kind: "PLACE" },
      { text: "New York", kind: "PLACE" },
    ]);
    expect(m.masked).toBe("I moved to [PLACE_1]");
    expect(applyMasks("hello", []).masked).toBe("hello");
  });

  it("segments rebuild the original text", () => {
    expect(r.segments.map((s) => s.value).join("")).toBe(TEXT);
  });
});

describe("unmask: graceful failure", () => {
  const map = { "[PERSON_1]": "Sam", "[PLACE_1]": "Boston" };

  it("tolerates small formatting changes by the model", () => {
    expect(unmask("Hi [person 1] and PLACE_1!", map).text).toBe("Hi Sam and Boston!");
  });

  it("replaces unknown placeholders with a neutral phrase and flags it", () => {
    const u = unmask("Tell [PERSON_9] hello", map);
    expect(u.text).toBe("Tell (a private detail) hello");
    expect(u.altered).toBe(true);
  });

  it("reports missing placeholders without failing", () => {
    const u = unmask("A reply with no placeholders", map);
    expect(u.text).toBe("A reply with no placeholders");
    expect(u.altered).toBe(false);
    expect(u.missing).toEqual(["[PERSON_1]", "[PLACE_1]"]);
  });
});
