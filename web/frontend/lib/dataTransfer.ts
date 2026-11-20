"use client";

import { buildBackup, type HavenBackup } from "@haven/backend";
import { clearAllData, getAllMessages, getAllSummaries, getJournalEntries, replaceAll } from "./db";
import { getProfile, saveProfile } from "./storage";

const PREFIX = "haven.";
const PROFILE_KEY = "haven.profile";
const AGREED_KEY = "haven.agreed";

function havenKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

export async function exportAll(): Promise<HavenBackup> {
  const [messages, summaries, journal] = await Promise.all([
    getAllMessages(),
    getAllSummaries(),
    getJournalEntries(),
  ]);
  const settings: Record<string, string> = {};
  for (const k of havenKeys()) {
    if (k === PROFILE_KEY || k === AGREED_KEY) continue;
    const v = window.localStorage.getItem(k);
    if (v !== null) settings[k.slice(PREFIX.length)] = v;
  }
  return buildBackup({
    facts: getProfile().facts,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      ts: m.ts,
      summarized: m.summarized,
      ...(m.source ? { source: m.source } : {}),
    })),
    summaries,
    journal,
    settings,
  });
}

export function downloadBackup(backup: HavenBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "haven-backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Replaces all current data with the (already validated) backup. */
export async function importBackup(b: HavenBackup): Promise<void> {
  await replaceAll(b.messages, b.summaries, b.journal);
  saveProfile({ facts: b.profile.facts });
  for (const [k, v] of Object.entries(b.settings)) window.localStorage.setItem(PREFIX + k, v);
}

/** Wipes Haven's IndexedDB stores and every haven.* localStorage key, including the "I agree" flag. */
export async function deleteEverything(): Promise<void> {
  await clearAllData();
  for (const k of havenKeys()) window.localStorage.removeItem(k);
}

export interface CacheClearResult {
  caches: number;
  databases: number;
}

/**
 * Clears temporary, non-personal caches: Cache Storage, session storage, and Firebase's cached
 * settings (installations, Remote Config). Chats, notes and settings are NOT touched.
 * The App Check database is deliberately kept, so a registered debug token stays valid.
 */
export async function clearAppCache(): Promise<CacheClearResult> {
  let cacheCount = 0;
  let dbCount = 0;
  if ("caches" in window) {
    const names = await window.caches.keys();
    await Promise.all(names.map((n) => window.caches.delete(n)));
    cacheCount = names.length;
  }
  try {
    window.sessionStorage.clear();
  } catch {
    /* storage may be blocked */
  }
  const dbs = (await window.indexedDB.databases?.()) ?? [];
  for (const d of dbs) {
    const name = d.name ?? "";
    if (!/^firebase/i.test(name) || /app-?check/i.test(name)) continue;
    await new Promise<void>((resolve) => {
      const req = window.indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    dbCount++;
  }
  return { caches: cacheCount, databases: dbCount };
}
