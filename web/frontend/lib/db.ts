"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ChatMessage, JournalEntry, SummaryRecord } from "./types";

interface HavenDB extends DBSchema {
  messages: {
    key: number;
    value: ChatMessage;
    indexes: { "by-ts": number };
  };
  summaries: {
    key: number;
    value: SummaryRecord;
    indexes: { "by-createdAt": number };
  };
  journal: {
    key: number;
    value: JournalEntry;
    indexes: { "by-day": string };
  };
}

export const DB_NAME = "haven";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<HavenDB>> | undefined;

function getDB(): Promise<IDBPDatabase<HavenDB>> {
  if (!dbPromise) {
    dbPromise = openDB<HavenDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Each step runs only for databases older than that version, so existing chats survive.
        if (oldVersion < 1) {
          const messages = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
          messages.createIndex("by-ts", "ts");
          const summaries = db.createObjectStore("summaries", {
            keyPath: "id",
            autoIncrement: true,
          });
          summaries.createIndex("by-createdAt", "createdAt");
        }
        if (oldVersion < 2) {
          const journal = db.createObjectStore("journal", { keyPath: "id", autoIncrement: true });
          journal.createIndex("by-day", "day");
        }
      },
    });
  }
  return dbPromise;
}

export async function addMessage(m: Omit<ChatMessage, "id">): Promise<ChatMessage> {
  const db = await getDB();
  const id = await db.add("messages", m as ChatMessage);
  return { ...m, id };
}

export async function getAllMessages(): Promise<ChatMessage[]> {
  const db = await getDB();
  return db.getAll("messages");
}

export async function markSummarized(ids: number[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("messages", "readwrite");
  for (const id of ids) {
    const m = await tx.store.get(id);
    if (m) await tx.store.put({ ...m, summarized: true });
  }
  await tx.done;
}

export async function addSummary(s: Omit<SummaryRecord, "id">): Promise<SummaryRecord> {
  const db = await getDB();
  const id = await db.add("summaries", s as SummaryRecord);
  return { ...s, id };
}

/** The latest summary is the current rolling summary. */
export async function getLatestSummary(): Promise<SummaryRecord | undefined> {
  const db = await getDB();
  const cursor = await db
    .transaction("summaries")
    .store.index("by-createdAt")
    .openCursor(null, "prev");
  return cursor?.value;
}

export async function getSummariesSince(ts: number): Promise<SummaryRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex("summaries", "by-createdAt", IDBKeyRange.lowerBound(ts));
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  await Promise.all([db.clear("messages"), db.clear("summaries"), db.clear("journal")]);
}

export async function getAllSummaries(): Promise<SummaryRecord[]> {
  const db = await getDB();
  return db.getAll("summaries");
}

export async function getMessagesSince(ts: number): Promise<ChatMessage[]> {
  const db = await getDB();
  return db.getAllFromIndex("messages", "by-ts", IDBKeyRange.lowerBound(ts));
}

/** Replace everything in IndexedDB with the given records (used by "Restore from file"). */
export async function replaceAll(
  messages: ChatMessage[],
  summaries: SummaryRecord[],
  journal: JournalEntry[] = [],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["messages", "summaries", "journal"], "readwrite");
  await Promise.all([
    tx.objectStore("messages").clear(),
    tx.objectStore("summaries").clear(),
    tx.objectStore("journal").clear(),
  ]);
  for (const m of messages) await tx.objectStore("messages").put(m);
  for (const s of summaries) await tx.objectStore("summaries").put(s);
  for (const j of journal) await tx.objectStore("journal").put(j);
  await tx.done;
}

export async function addJournalEntry(e: Omit<JournalEntry, "id">): Promise<JournalEntry> {
  const db = await getDB();
  const id = await db.add("journal", e as JournalEntry);
  return { ...e, id };
}

export async function updateJournalEntry(e: JournalEntry): Promise<void> {
  const db = await getDB();
  await db.put("journal", e);
}

export async function deleteJournalEntry(id: number): Promise<void> {
  const db = await getDB();
  await db.delete("journal", id);
}

/** All entries, newest day first (and newest entry first within a day). */
export async function getJournalEntries(): Promise<JournalEntry[]> {
  const db = await getDB();
  const all = await db.getAll("journal");
  return all.sort((a, b) => (a.day === b.day ? b.createdAt - a.createdAt : a.day < b.day ? 1 : -1));
}

/** Entries whose day is on or after `day` ("YYYY-MM-DD"). */
export async function getJournalSince(day: string): Promise<JournalEntry[]> {
  const db = await getDB();
  return db.getAllFromIndex("journal", "by-day", IDBKeyRange.lowerBound(day));
}
