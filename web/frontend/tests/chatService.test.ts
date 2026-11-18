import { beforeEach, describe, expect, it, vi } from "vitest";

// Firebase AI, IndexedDB and localStorage are all mocked.
vi.mock("../lib/ai", () => ({
  chat: vi.fn(),
  chatStream: vi.fn(),
  summarize: vi.fn(),
  extractMemory: vi.fn(),
}));
vi.mock("../lib/db", () => ({
  addMessage: vi.fn(async (m: object) => ({ id: 1, ...m })),
  addSummary: vi.fn(),
  getAllMessages: vi.fn(async () => []),
  getLatestSummary: vi.fn(async () => summaryRef.value),
  markSummarized: vi.fn(),
}));

// Small on-device settings, held in plain variables for the tests.
const store = vi.hoisted(() => ({
  mode: "listen" as "listen" | "help",
  listen: { streak: 0, offered: false, asked: false },
  recentCards: [] as string[],
  dismissed: [] as string[],
}));
const summaryRef = vi.hoisted(() => ({ value: undefined as undefined | { text: string } }));
vi.mock("../lib/storage", () => ({
  getProfile: () => ({ facts: [{ id: "1", text: "Finals next week" }] }),
  getMode: () => store.mode,
  getListenState: () => store.listen,
  saveListenState: (s: typeof store.listen) => {
    store.listen = s;
  },
  getRecentCards: () => store.recentCards,
  noteCardsUsed: (ids: string[]) => {
    store.recentCards = [...store.recentCards, ...ids];
  },
  getDismissedMemories: () => store.dismissed,
  dismissMemory: (t: string) => store.dismissed.push(t),
}));

import { chat, chatStream, extractMemory } from "../lib/ai";
import {
  buildCloudRequest,
  commitTurn,
  CrisisDetectedError,
  generateReply,
  looksTooLong,
  planTurn,
  saveCloudReply,
  suggestMemory,
} from "../lib/chatService";
import { splitSentences } from "../lib/format";
import type { ChatMessage } from "../lib/types";

const chatMock = vi.mocked(chat);
const streamMock = vi.mocked(chatStream);
const extractMock = vi.mocked(extractMemory);

beforeEach(() => {
  chatMock.mockReset();
  streamMock.mockReset();
  extractMock.mockReset();
  store.mode = "listen";
  store.listen = { streak: 0, offered: false, asked: false };
  store.recentCards = [];
  store.dismissed = [];
  summaryRef.value = undefined;
});

const msg = (role: "user" | "assistant", ts: number): ChatMessage => ({
  role,
  content: "hello",
  ts,
  summarized: false,
});

describe("crisis safety: no model is ever called", () => {
  const phrases = [
    "I want to kill myself",
    "i dont want to be here anymore",
    "thinking about ending it all",
  ];

  it.each(phrases)("generateReply refuses and calls no model: %s", async (p) => {
    await expect(generateReply(p, [])).rejects.toBeInstanceOf(CrisisDetectedError);
    expect(chatMock).not.toHaveBeenCalled();
    expect(streamMock).not.toHaveBeenCalled();
  });

  it.each(phrases)("buildCloudRequest refuses too: %s", async (p) => {
    await expect(buildCloudRequest(p, [])).rejects.toBeInstanceOf(CrisisDetectedError);
  });
});

describe("normal replies", () => {
  it("Help mode: builds a prompt with profile and a retrieved coping card, then calls the on-device model once", async () => {
    store.mode = "help";
    chatMock.mockResolvedValue({
      text: "That sounds stressful. Want to try a slow breath?",
      source: "on_device",
    });
    const reply = await generateReply("I'm panicking about my exam", []);
    expect(chatMock).toHaveBeenCalledOnce();
    const prompt = chatMock.mock.calls[0][0];
    expect(prompt).toContain("Finals next week");
    expect(prompt).toMatch(/technique you may offer/);
    expect(prompt).toMatch(/User: I'm panicking about my exam\n\[Remember: .*\]\nHaven:$/);
    expect(reply.source).toBe("on_device");
  });

  it("streams when a partial callback is given", async () => {
    streamMock.mockImplementation(async (_p, onPartial) => {
      onPartial("Hel");
      onPartial("Hello");
      return { text: "Hello", source: "on_device" };
    });
    const seen: string[] = [];
    const reply = await generateReply("hi", [], (t) => seen.push(t));
    expect(seen).toEqual(["Hel", "Hello"]);
    expect(reply.content).toBe("Hello");
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("cloud request keeps personal text separate from the fixed instruction", async () => {
    const { personalText, instruction } = await buildCloudRequest("my boyfriend cheated on me", []);
    expect(personalText).toContain("my boyfriend cheated on me");
    expect(personalText).toContain("Finals next week");
    expect(instruction).not.toContain("Finals next week");
    expect(instruction).toMatch(/never diagnose/i);
  });
});

describe("reply modes", () => {
  it("Listen mode (the default) sends no coping card, even when one matches", async () => {
    chatMock.mockResolvedValue({ text: "That sounds heavy.", source: "on_device" });
    await generateReply("I'm panicking about my exam", []);
    const prompt = chatMock.mock.calls[0][0];
    expect(prompt).not.toMatch(/technique you may offer/);
    expect(prompt).toMatch(/mostly want to be heard/);
  });

  it("a clear ask switches to Help for that reply only, without changing the saved mode", async () => {
    const plan = await planTurn("I'm panicking about my exam, what should I do?", []);
    expect(plan.mode).toBe("help");
    expect(plan.cards.length).toBeGreaterThan(0);
    expect(store.mode).toBe("listen");
  });

  it("skips cards used in recent replies", async () => {
    store.mode = "help";
    const first = await planTurn("I'm panicking about my exam", []);
    expect(first.cards.length).toBeGreaterThan(0);
    store.recentCards = first.cards.map((c) => c.id);
    const second = await planTurn("I'm panicking about my exam", []);
    for (const c of second.cards) expect(first.cards.map((x) => x.id)).not.toContain(c.id);
  });

  it("skips a technique the summary says was already tried", async () => {
    store.mode = "help";
    const first = await planTurn("I'm panicking about my exam", []);
    const title = first.cards[0].title;
    summaryRef.value = { text: `Tried / didn't help: ${title}` };
    const again = await planTurn("I'm panicking about my exam", []);
    expect(again.cards.map((c) => c.title)).not.toContain(title);
  });

  it("Listen alternates: a question, then an invitation, then a question", async () => {
    chatMock.mockResolvedValue({ text: "I hear you.", source: "on_device" });
    for (let i = 0; i < 4; i++) await generateReply("I'm so tired of everything lately", []);
    const asked = chatMock.mock.calls.map(([p]) => !/Do not ask a question this time/.test(p));
    expect(asked).toEqual([true, false, true, false]);
    expect(chatMock.mock.calls[1][0]).toMatch(/no question this time/);
  });

  it("offers ideas once, on a question turn after three Listen replies, then stops", async () => {
    chatMock.mockResolvedValue({ text: "I hear you.", source: "on_device" });
    for (let i = 0; i < 7; i++) await generateReply("I'm so tired of everything lately", []);
    const offered = chatMock.mock.calls.map(([p]) => /whether they'd like some ideas/.test(p));
    expect(offered).toEqual([false, false, false, false, true, false, false]);
    // The offer is a question turn, so the reply after it is an invitation.
    expect(chatMock.mock.calls[5][0]).toMatch(/Do not ask a question this time/);
  });

  it("a Help reply resets the alternation, so the next Listen reply asks again", async () => {
    chatMock.mockResolvedValue({ text: "I hear you.", source: "on_device" });
    await generateReply("so tired lately", []);
    await generateReply("so tired lately", []); // invitation turn
    store.mode = "help";
    await generateReply("so tired lately", []);
    store.mode = "listen";
    await generateReply("so tired lately", []);
    expect(chatMock.mock.calls[3][0]).not.toMatch(/Do not ask a question this time/);
    expect(store.listen).toMatchObject({ streak: 1, asked: true });
  });

  it("the cloud fallback alternates too", async () => {
    const first = await buildCloudRequest("so tired lately", []);
    expect(first.plan.askQuestion).toBe(true);
    expect(first.instruction).toMatch(/End with one caring question/);
    commitTurn(first.plan);
    const second = await buildCloudRequest("so tired lately", []);
    expect(second.plan.askQuestion).toBe(false);
    expect(second.instruction).toMatch(/Do not ask a question this time/);
  });

  it("retries once with a smaller prompt when the model says the input is too long", async () => {
    chatMock
      .mockRejectedValueOnce(new Error("The input is too long for the on-device model"))
      .mockResolvedValueOnce({ text: "I'm here.", source: "on_device" });
    const reply = await generateReply("hello there", []);
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(reply.content).toBe("I'm here.");
    expect(looksTooLong(new Error("something else broke"))).toBe(false);
  });

  it("does not retry on other errors", async () => {
    chatMock.mockRejectedValue(new Error("boom"));
    await expect(generateReply("hello there", [])).rejects.toThrow("boom");
    expect(chatMock).toHaveBeenCalledOnce();
  });
});

describe("time awareness", () => {
  const now = 1_800_000_000_000;
  const h = 3_600_000;

  it("adds a gap and the open threads after six hours or more", async () => {
    summaryRef.value = { text: "Going on: exams\nOpen threads: exam on Friday" };
    const plan = await planTurn("hi again", [msg("assistant", now - 72 * h)], now);
    expect(plan.lastTalked).toBe("3 days ago");
    expect(plan.openThreads).toBe("exam on Friday");
  });

  it("adds nothing for a short gap or a first message", async () => {
    expect((await planTurn("hi", [msg("assistant", now - 2 * h)], now)).lastTalked).toBeUndefined();
    expect((await planTurn("hi", [], now)).lastTalked).toBeUndefined();
  });

  it("reaches the prompt", async () => {
    chatMock.mockResolvedValue({ text: "Welcome back.", source: "on_device" });
    await generateReply("hi again", [msg("assistant", Date.now() - 50 * h)]);
    expect(chatMock.mock.calls[0][0]).toMatch(/You last talked 2 days ago/);
  });
});

describe("cloud fallback has the same upgrades", () => {
  it("uses the mode instruction, and cards only in Help mode", async () => {
    const listen = await buildCloudRequest("I'm panicking about my exam", []);
    expect(listen.instruction).toMatch(/mostly want to be heard/);
    expect(listen.instruction).not.toMatch(/technique you may offer/);
    store.mode = "help";
    const help = await buildCloudRequest("I'm panicking about my exam", []);
    expect(help.instruction).toMatch(/want help thinking it through/);
    expect(help.instruction).toMatch(/technique you may offer/);
  });

  it("keeps the gap and open threads in the personal text, never the fixed instruction", async () => {
    summaryRef.value = { text: "Open threads: exam on Friday" };
    const now = Date.now();
    const { personalText, instruction } = await buildCloudRequest("hi again", [
      msg("assistant", now - 80 * 3_600_000),
    ]);
    expect(personalText).toMatch(/You last talked 3 days ago/);
    expect(personalText).toContain("exam on Friday");
    expect(instruction).not.toContain("exam on Friday");
  });

  it("commitTurn records the Listen streak only when called", async () => {
    const { plan } = await buildCloudRequest("so tired lately", []);
    expect(store.listen.streak).toBe(0);
    commitTurn(plan);
    expect(store.listen.streak).toBe(1);
  });
});

describe("suggested memories", () => {
  const longMsg = "My exam is on Friday and I have not started studying at all yet";

  it("returns a vetted fact from the on-device model", async () => {
    extractMock.mockResolvedValue({ text: "Exam on Friday", source: "on_device" });
    expect(await suggestMemory(longMsg)).toBe("Exam on Friday");
    expect(extractMock).toHaveBeenCalledOnce();
  });

  it("skips short messages without calling the model", async () => {
    expect(await suggestMemory("ok thanks")).toBeNull();
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("never runs on crisis text", async () => {
    expect(
      await suggestMemory("I want to kill myself and I can't take this anymore at all"),
    ).toBeNull();
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("drops health facts, 'none', declined facts and model errors", async () => {
    extractMock.mockResolvedValueOnce({ text: "Takes antidepressants", source: "on_device" });
    expect(await suggestMemory(longMsg)).toBeNull();
    extractMock.mockResolvedValueOnce({ text: "none", source: "on_device" });
    expect(await suggestMemory(longMsg)).toBeNull();
    store.dismissed = ["Exam on Friday"];
    extractMock.mockResolvedValueOnce({ text: "Exam on Friday", source: "on_device" });
    expect(await suggestMemory(longMsg)).toBeNull();
    extractMock.mockRejectedValueOnce(new Error("model gone"));
    expect(await suggestMemory(longMsg)).toBeNull();
  });
});

describe("replies are cleaned and capped before they are saved", () => {
  const long =
    "Haven: Oh honey, that sounds hard. You are carrying a lot. It makes sense to feel worn out. " +
    "Many people would. You deserve some rest. Is there anyone you trust? What would help most?";

  it("on-device replies: label, pet name and extra sentences are gone", async () => {
    chatMock.mockResolvedValue({ text: long, source: "on_device" });
    const reply = await generateReply("I'm so tired of everything lately", []);
    expect(reply.content).not.toMatch(/Haven:|honey/);
    expect(reply.content.startsWith("That sounds hard.")).toBe(true);
    expect(reply.content.endsWith("What would help most?")).toBe(true);
    expect(splitSentences(reply.content).length).toBeLessThanOrEqual(4);
  });

  it("cloud replies get the same treatment, using the mode's limit", async () => {
    const listen = await saveCloudReply(long, "listen");
    expect(listen.content).not.toMatch(/Haven:|honey/);
    expect(splitSentences(listen.content)).toHaveLength(4);
    const help = await saveCloudReply(long, "help");
    expect(splitSentences(help.content)).toHaveLength(6);
    expect(help.source).toBe("cloud");
  });
});
