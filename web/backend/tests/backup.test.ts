import { describe, expect, it } from "vitest";
import {
  BACKUP_VERSION,
  MAX_SETTING,
  NOTE_COLORS,
  buildBackup,
  isRealDay,
  validateBackup,
} from "../src";

const good = () =>
  buildBackup({
    facts: [{ id: "f1", text: "Finals next week" }],
    messages: [
      { id: 1, role: "user", content: "hi", ts: 1700000000000, summarized: false },
      {
        id: 2,
        role: "assistant",
        content: "hello",
        ts: 1700000001000,
        summarized: false,
        source: "on_device",
      },
    ],
    summaries: [{ id: 1, createdAt: 1700000002000, text: "They said hi.", upToMessageId: 2 }],
    settings: { country: "CA" },
  });

describe("backup export/import validation", () => {
  it("accepts what buildBackup produces (JSON round trip)", () => {
    const parsed = JSON.parse(JSON.stringify(good()));
    const v = validateBackup(parsed);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.backup.messages).toHaveLength(2);
      expect(v.backup.profile.facts[0].text).toBe("Finals next week");
      expect(v.backup.settings.country).toBe("CA");
      expect(v.backup.version).toBe(BACKUP_VERSION);
    }
  });

  it("rejects non-Haven or non-object input", () => {
    for (const bad of [null, 5, "x", [], {}, { app: "other" }])
      expect(validateBackup(bad).ok).toBe(false);
  });

  it("rejects unsupported versions", () => {
    expect(validateBackup({ ...good(), version: 99 }).ok).toBe(false);
    expect(validateBackup({ ...good(), version: 0 }).ok).toBe(false);
  });

  it("rejects malformed messages, summaries, notes and settings", () => {
    const g = good();
    expect(
      validateBackup({
        ...g,
        messages: [{ role: "robot", content: "x", ts: 1, summarized: false }],
      }).ok,
    ).toBe(false);
    expect(
      validateBackup({ ...g, messages: [{ role: "user", content: 5, ts: 1, summarized: false }] })
        .ok,
    ).toBe(false);
    expect(
      validateBackup({ ...g, summaries: [{ createdAt: "now", text: "x", upToMessageId: 1 }] }).ok,
    ).toBe(false);
    expect(validateBackup({ ...g, profile: { facts: [{ id: 1, text: "x" }] } }).ok).toBe(false);
    expect(validateBackup({ ...g, settings: { "bad key!": "x" } }).ok).toBe(false);
    expect(validateBackup({ ...g, messages: "nope" }).ok).toBe(false);
  });

  it("drops unknown fields (nothing unexpected gets restored)", () => {
    const g = good() as unknown as Record<string, unknown>;
    (g.messages as Record<string, unknown>[])[0].evil = "<script>";
    const v = validateBackup(g);
    expect(v.ok).toBe(true);
    if (v.ok) expect("evil" in v.backup.messages[0]).toBe(false);
  });
});

describe("journal in backups (version 2)", () => {
  const entry = {
    id: 1,
    day: "2026-11-14",
    mood: 4,
    text: "Hard day.",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
  const withJournal = (journal: unknown) => ({ ...good(), journal });

  it("round-trips a valid journal entry and keeps the crisis flag", () => {
    const flagged = { ...entry, id: 2, crisisFlag: true };
    const v = validateBackup(JSON.parse(JSON.stringify(withJournal([entry, flagged]))));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.backup.journal).toHaveLength(2);
      expect(v.backup.journal[0].mood).toBe(4);
      expect(v.backup.journal[1].crisisFlag).toBe(true);
    }
  });

  it("still accepts a version 1 backup that has no journal", () => {
    const old = { ...good(), version: 1 } as Record<string, unknown>;
    delete old.journal;
    const v = validateBackup(old);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.backup.journal).toEqual([]);
  });

  it("rejects bad moods: 0, 11, 5.5, text, missing", () => {
    for (const mood of [0, 11, 5.5, "5", undefined, NaN])
      expect(validateBackup(withJournal([{ ...entry, mood }])).ok).toBe(false);
  });

  it("rejects bad days and impossible dates", () => {
    for (const day of ["today", "2026-1-5", "2026-02-31", "2026-13-01", 20261114, undefined])
      expect(validateBackup(withJournal([{ ...entry, day }])).ok).toBe(false);
  });

  it("rejects over-long text and non-array journals", () => {
    expect(validateBackup(withJournal([{ ...entry, text: "x".repeat(10_001) }])).ok).toBe(false);
    expect(validateBackup(withJournal("nope")).ok).toBe(false);
  });

  it("drops unknown fields from entries", () => {
    const v = validateBackup(withJournal([{ ...entry, evil: "<script>" }]));
    expect(v.ok && "evil" in v.backup.journal[0]).toBe(false);
  });

  it("isRealDay accepts real days only", () => {
    expect(isRealDay("2028-02-29")).toBe(true);
    expect(isRealDay("2027-02-29")).toBe(false);
  });

  it("accepts every note colour and drops entries with an unknown one", () => {
    for (const color of NOTE_COLORS) {
      const v = validateBackup(withJournal([{ ...entry, color }]));
      expect(v.ok && v.backup.journal[0].color).toBe(color);
    }
    expect(validateBackup(withJournal([{ ...entry, color: "red" }])).ok).toBe(false);
    expect(validateBackup(withJournal([{ ...entry, color: 3 }])).ok).toBe(false);
  });

  it("treats the colour as optional (older entries have none)", () => {
    const v = validateBackup(withJournal([entry]));
    expect(v.ok && "color" in v.backup.journal[0]).toBe(false);
  });
});

describe("profile fact source (version 3)", () => {
  const withFacts = (facts: unknown) => ({ ...good(), profile: { facts } });

  it("keeps the source of a suggested fact and accepts older facts without one", () => {
    const v = validateBackup(
      withFacts([
        { id: "a", text: "Exam on Friday", source: "suggested" },
        { id: "b", text: "Lives with two roommates" },
      ]),
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.backup.profile.facts[0].source).toBe("suggested");
      expect(v.backup.profile.facts[1].source).toBeUndefined();
    }
  });

  it("rejects an unknown source", () => {
    expect(validateBackup(withFacts([{ id: "a", text: "x", source: "robot" }])).ok).toBe(false);
  });

  it("is version 3 and still reads versions 1 and 2", () => {
    expect(BACKUP_VERSION).toBe(3);
    for (const version of [1, 2, 3]) expect(validateBackup({ ...good(), version }).ok).toBe(true);
    expect(validateBackup({ ...good(), version: 4 }).ok).toBe(false);
  });
});

describe("long settings (a saved Small steps plan)", () => {
  const withSetting = (value: string) => ({ ...good(), settings: { plan: value } });

  it("accepts a setting of many thousand characters (a 4-week plan)", () => {
    expect(MAX_SETTING).toBe(20000);
    const v = validateBackup(withSetting("x".repeat(15000)));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.backup.settings.plan).toHaveLength(15000);
  });

  it("still rejects a setting over the limit", () => {
    expect(validateBackup(withSetting("x".repeat(MAX_SETTING + 1))).ok).toBe(false);
  });
});
