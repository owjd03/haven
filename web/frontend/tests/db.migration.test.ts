import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";

describe("IndexedDB upgrade from v1 to v2", () => {
  it("keeps existing chats and adds the journal store", async () => {
    // Build a version 1 database exactly as the first release did.
    const old = await openDB("haven", 1, {
      upgrade(db) {
        db.createObjectStore("messages", { keyPath: "id", autoIncrement: true }).createIndex(
          "by-ts",
          "ts",
        );
        db.createObjectStore("summaries", { keyPath: "id", autoIncrement: true }).createIndex(
          "by-createdAt",
          "createdAt",
        );
      },
    });
    await old.add("messages", { role: "user", content: "hi from v1", ts: 1, summarized: false });
    old.close();

    const db = await import("../lib/db");
    expect((await db.getAllMessages()).map((m) => m.content)).toEqual(["hi from v1"]);
    expect(await db.getJournalEntries()).toEqual([]);

    const saved = await db.addJournalEntry({
      day: "2026-11-14",
      mood: 6,
      text: "ok day",
      createdAt: 10,
      updatedAt: 10,
    });
    expect(saved.id).toBeDefined();
    expect((await db.getJournalEntries())[0].text).toBe("ok day");
  });

  it("orders newest day first, filters by day, edits, deletes, and is cleared by clearAllData", async () => {
    const db = await import("../lib/db");
    await db.clearAllData();
    const mk = (day: string, createdAt: number) =>
      db.addJournalEntry({ day, mood: 5, text: day, createdAt, updatedAt: createdAt });
    const a = await mk("2026-11-10", 1);
    await mk("2026-11-12", 2);
    await mk("2026-11-12", 3);
    const order = (await db.getJournalEntries()).map((e) => `${e.day}#${e.createdAt}`);
    expect(order).toEqual(["2026-11-12#3", "2026-11-12#2", "2026-11-10#1"]);
    expect(await db.getJournalSince("2026-11-11")).toHaveLength(2);

    await db.updateJournalEntry({ ...a, mood: 9 });
    expect((await db.getJournalSince("2026-11-10")).find((e) => e.id === a.id)?.mood).toBe(9);
    await db.deleteJournalEntry(a.id!);
    expect(await db.getJournalEntries()).toHaveLength(2);

    await db.clearAllData();
    expect(await db.getJournalEntries()).toEqual([]);
  });
});
