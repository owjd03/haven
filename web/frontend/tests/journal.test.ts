import { describe, expect, it } from "vitest";
import { isSendable, shiftDay, validateEntry } from "../lib/journal";
import type { JournalEntry } from "../lib/types";

let nextId = 1;
const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: nextId++,
  day: "2026-11-14",
  mood: 5,
  text: "An ordinary day.",
  createdAt: nextId,
  updatedAt: nextId,
  ...over,
});

describe("validateEntry", () => {
  const ok = { day: "2026-11-14", mood: 4, text: "hard day" };
  const today = "2026-11-16";

  it("accepts a normal entry, today and past days", () => {
    expect(validateEntry(ok, today)).toBeNull();
    expect(validateEntry({ ...ok, day: today }, today)).toBeNull();
  });
  it("requires a mood from 1 to 10, with nothing assumed", () => {
    for (const mood of [null, 0, 11, 5.5, NaN])
      expect(validateEntry({ ...ok, mood }, today), String(mood)).toMatch(/1 to 10/);
  });
  it("rejects empty text, future days and impossible days", () => {
    expect(validateEntry({ ...ok, text: "   " }, today)).toMatch(/Write a little/);
    expect(validateEntry({ ...ok, day: "2026-11-17" }, today)).toMatch(/hasn't happened/);
    expect(validateEntry({ ...ok, day: "2026-02-31" }, today)).toMatch(/valid day/);
  });
  it("rejects over-long text", () => {
    expect(validateEntry({ ...ok, text: "x".repeat(10_001) }, today)).toMatch(
      /too long|a bit long/,
    );
  });
});

describe("shiftDay", () => {
  it("moves by calendar days across month and year ends", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-11-16", -6)).toBe("2026-11-10");
  });
  it("is not thrown off by daylight saving changes", () => {
    expect(shiftDay("2026-03-09", 1)).toBe("2026-03-10");
    expect(shiftDay("2026-11-02", 1)).toBe("2026-11-03");
    expect(shiftDay("2026-11-02", -1)).toBe("2026-11-01");
  });
});

describe("crisis entries never go to the cloud", () => {
  const crisis = "I want to end my life";

  it("treats a flagged entry as not sendable", () => {
    expect(isSendable(entry({ crisisFlag: true }))).toBe(false);
  });
  it("re-checks the text even if the flag is missing (e.g. an edited backup file)", () => {
    expect(isSendable(entry({ text: crisis }))).toBe(false);
  });
});
