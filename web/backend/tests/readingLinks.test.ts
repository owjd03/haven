import { describe, expect, it } from "vitest";
import {
  MAX_READING,
  PLAN_IDEAS,
  READING_LINKS,
  SITUATIONS,
  isHttpsUrl,
  readingFor,
  readingForIdeas,
  resolveReading,
  type ReadingLink,
} from "../src";

const link = (id: string, situation: ReadingLink["situation"]): ReadingLink => ({
  id,
  situation,
  title: id,
  publisher: "Test",
  url: `https://example.org/${id}`,
  checked: "2026-11-22",
});
const FIXTURE: ReadingLink[] = [
  link("h1", "heartbreak"),
  link("h2", "heartbreak"),
  link("h3", "heartbreak"),
  link("g1", "grief"),
  link("g2", "grief"),
  link("s1", "stress"),
];

describe("the reading list itself", () => {
  it("has a few pages for every situation", () => {
    for (const s of SITUATIONS)
      expect(READING_LINKS.filter((l) => l.situation === s).length).toBeGreaterThanOrEqual(3);
  });

  it("has unique ids and unique addresses", () => {
    expect(new Set(READING_LINKS.map((l) => l.id)).size).toBe(READING_LINKS.length);
    expect(new Set(READING_LINKS.map((l) => l.url)).size).toBe(READING_LINKS.length);
  });

  it("only uses https addresses, with a title, a publisher and a check date", () => {
    for (const l of READING_LINKS) {
      expect(isHttpsUrl(l.url), l.url).toBe(true);
      expect(l.title.trim().length, l.id).toBeGreaterThan(3);
      expect(l.publisher.trim().length, l.id).toBeGreaterThan(1);
      expect(l.checked, l.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(SITUATIONS).toContain(l.situation);
    }
  });

  it("never calls a page proven or reviewed", () => {
    for (const l of READING_LINKS) expect(l.title).not.toMatch(/proven|clinically|reviewed/i);
  });
});

describe("readingFor", () => {
  it("takes one page from each situation in turn, most relevant first", () => {
    const ids = readingFor(["grief", "heartbreak"], 5, FIXTURE).map((l) => l.id);
    expect(ids).toEqual(["g1", "h1", "g2", "h2", "h3"]);
  });

  it("stops at the cap and never repeats a page", () => {
    const ids = readingFor(["heartbreak", "heartbreak", "grief"], 3, FIXTURE).map((l) => l.id);
    expect(ids).toEqual(["h1", "g1", "h2"]);
    expect(readingFor(["heartbreak", "grief", "stress"], 99, FIXTURE)).toHaveLength(6);
  });

  it("uses the default cap of 5 on the real list", () => {
    expect(readingFor([...SITUATIONS])).toHaveLength(MAX_READING);
  });

  it("gives nothing for no situations", () => {
    expect(readingFor([])).toEqual([]);
  });
});

describe("readingForIdeas", () => {
  const ideaIn = (situation: ReadingLink["situation"]) =>
    PLAN_IDEAS.find((i) => i.situation === situation)!;

  it("puts the situation that came up most first", () => {
    const ideas = [ideaIn("grief"), ideaIn("stress"), ideaIn("stress")];
    const first = readingForIdeas(ideas)[0];
    expect(first.situation).toBe("stress");
  });

  it("gives nothing when no ideas were used", () => {
    expect(readingForIdeas([])).toEqual([]);
  });
});

describe("resolveReading", () => {
  const real = READING_LINKS.slice(0, 3).map((l) => l.id);

  it("turns known ids back into links, in order", () => {
    expect(resolveReading(real).map((l) => l.id)).toEqual(real);
  });

  it("drops ids that are not in the library, so stored data can't add a link", () => {
    const out = resolveReading(["https://evil.example/x", "nope", real[0], 42, null]);
    expect(out.map((l) => l.id)).toEqual([real[0]]);
  });

  it("drops repeats and keeps at most the cap", () => {
    expect(resolveReading([real[0], real[0], real[1]])).toHaveLength(2);
    const all = READING_LINKS.map((l) => l.id);
    expect(resolveReading(all)).toHaveLength(MAX_READING);
  });

  it("copes with nothing at all", () => {
    expect(resolveReading(undefined)).toEqual([]);
    expect(resolveReading([])).toEqual([]);
  });

  it("refuses an entry whose address is not https", () => {
    const bad = [{ ...link("x1", "stress"), url: "javascript:alert(1)" }];
    expect(resolveReading(["x1"], bad)).toEqual([]);
  });
});
