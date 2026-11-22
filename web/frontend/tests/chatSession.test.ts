import { beforeEach, describe, expect, it, vi } from "vitest";

// The model, IndexedDB and the chat service are mocked. These tests are about the store only:
// what it keeps while no page is watching, and what it refuses to do.
vi.mock("../lib/ai", () => ({
  toHavenError: (e: unknown) => e as { kind: string; message: string },
}));
vi.mock("../lib/db", () => ({
  addMessage: vi.fn(async (m: object) => ({ id: Math.floor(Math.random() * 1e9), ...m })),
  getAllMessages: vi.fn(async () => []),
}));
vi.mock("../lib/chatService", () => ({
  CrisisDetectedError: class CrisisDetectedError extends Error {},
  generateReply: vi.fn(),
  buildCloudRequest: vi.fn(async () => ({
    personalText: "personal",
    instruction: "instruction",
    plan: { mode: "listen" },
  })),
  saveCloudReply: vi.fn(async (text: string) => ({
    id: 99,
    role: "assistant",
    content: text,
    ts: 1,
    summarized: false,
    source: "cloud",
  })),
  commitTurn: vi.fn(),
  suggestMemory: vi.fn(async () => null),
}));

import { addMessage, getAllMessages } from "../lib/db";
import { generateReply, suggestMemory } from "../lib/chatService";
import {
  answerConsent,
  getSnapshot,
  leaveChat,
  loadMessages,
  resetChatSessionForTests,
  send,
  subscribe,
  type SendDeps,
} from "../lib/chatSession";
import type { ChatMessage } from "../lib/types";

const generateMock = vi.mocked(generateReply);
const suggestMock = vi.mocked(suggestMemory);

const reply = (content: string): ChatMessage => ({
  id: 50,
  role: "assistant",
  content,
  ts: 2,
  summarized: false,
  source: "on_device",
});

function deps(over: Partial<SendDeps> = {}): SendDeps {
  return {
    deviceReady: true,
    triggerCrisis: vi.fn(),
    markSource: vi.fn(),
    runShielded: vi.fn(async () => ({ text: "cloud words", altered: false })),
    ...over,
  };
}

/** A promise you resolve by hand, to hold a reply open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetChatSessionForTests();
  generateMock.mockReset();
  suggestMock.mockClear();
  vi.mocked(addMessage).mockClear();
  vi.mocked(getAllMessages).mockReset();
  vi.mocked(getAllMessages).mockResolvedValue([]);
});

describe("a reply keeps running with nobody watching", () => {
  it("finishes, and the next viewer sees the whole exchange", async () => {
    const held = deferred<ChatMessage>();
    generateMock.mockReturnValueOnce(held.promise);

    // Nobody subscribes: this is the state while the person is on another tab.
    expect(send("hello there", deps())).toBe(true);
    expect(getSnapshot().thinking).toBe(true);

    held.resolve(reply("hi, I'm here"));
    await settle();

    const snap = getSnapshot();
    expect(snap.thinking).toBe(false);
    expect(snap.messages.map((m) => m.content)).toEqual(["hello there", "hi, I'm here"]);
  });

  it("shows a late viewer the typing state and the text so far", async () => {
    const held = deferred<ChatMessage>();
    generateMock.mockImplementationOnce(async (_t, _r, onPartial) => {
      onPartial?.("Thanks for telling");
      return held.promise;
    });

    send("rough day", deps());
    await settle();

    // A page opening now (the person came back) reads the store.
    const snap = getSnapshot();
    expect(snap.thinking).toBe(true);
    expect(snap.partial).toBe("Thanks for telling");

    held.resolve(reply("Thanks for telling me."));
    await settle();
    expect(getSnapshot().partial).toBe("");
  });

  it("tells watchers when something changes", async () => {
    generateMock.mockResolvedValueOnce(reply("ok"));
    const seen = vi.fn();
    const off = subscribe(seen);
    send("hi", deps());
    await settle();
    expect(seen).toHaveBeenCalled();
    off();
    seen.mockClear();
    send("again", deps());
    await settle();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("sending", () => {
  it("refuses a second message while a reply is running", async () => {
    const held = deferred<ChatMessage>();
    generateMock.mockReturnValueOnce(held.promise);
    expect(send("first", deps())).toBe(true);
    expect(send("second", deps())).toBe(false);
    held.resolve(reply("ok"));
    await settle();
    expect(vi.mocked(addMessage).mock.calls.filter(([m]) => m.role === "user")).toHaveLength(1);
  });

  it("ignores empty text", () => {
    expect(send("   ", deps())).toBe(false);
    expect(getSnapshot().thinking).toBe(false);
  });

  it("on crisis words calls no model and saves nothing", async () => {
    const d = deps();
    expect(send("I want to kill myself", d)).toBe(true);
    await settle();
    expect(d.triggerCrisis).toHaveBeenCalledTimes(1);
    expect(generateMock).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
    expect(getSnapshot().thinking).toBe(false);
    expect(getSnapshot().messages).toEqual([]);
  });

  it("shows an error notice and frees the box when the reply fails", async () => {
    generateMock.mockRejectedValueOnce({ kind: "unknown", message: "Something went wrong." });
    send("hello", deps());
    await settle();
    const snap = getSnapshot();
    expect(snap.thinking).toBe(false);
    expect(snap.messages.at(-1)).toMatchObject({ error: true, content: "Something went wrong." });
  });

  it("drops a memory suggestion if a newer message was sent", async () => {
    let finishMemory!: (v: string | null) => void;
    suggestMock.mockReturnValueOnce(
      new Promise<string | null>((r) => {
        finishMemory = r;
      }),
    );
    generateMock.mockResolvedValue(reply("ok"));
    send("I start a new job on Monday", deps());
    await settle();
    send("one more thing", deps());
    await settle();
    finishMemory("Starts a new job on Monday");
    await settle();
    expect(getSnapshot().suggestion).toBeNull();
  });
});

describe("the cloud path", () => {
  it("sends nothing if the person leaves during the cloud question", async () => {
    const d = deps({ deviceReady: false });
    send("hello", d);
    await settle();
    expect(getSnapshot().askingConsent).toBe(true);

    leaveChat(); // the Chat page is removed
    await settle();

    expect(d.runShielded).not.toHaveBeenCalled();
    const snap = getSnapshot();
    expect(snap.askingConsent).toBe(false);
    expect(snap.thinking).toBe(false);
    expect(snap.messages.at(-1)).toMatchObject({ notice: true });
  });

  it("goes through the privacy shield after a yes", async () => {
    const d = deps({ deviceReady: false });
    send("hello", d);
    await settle();
    answerConsent(true);
    await settle();
    expect(d.runShielded).toHaveBeenCalledWith(
      expect.objectContaining({ text: "personal", instruction: "instruction" }),
    );
    expect(getSnapshot().messages.at(-1)).toMatchObject({
      content: "cloud words",
      source: "cloud",
    });
  });

  it("offers the cloud when the private model fails", async () => {
    generateMock.mockRejectedValueOnce({ kind: "device_unavailable", message: "no" });
    send("hello", deps());
    await settle();
    expect(getSnapshot().askingConsent).toBe(true);
    answerConsent(false);
    await settle();
    expect(getSnapshot().thinking).toBe(false);
  });
});

describe("loading the saved conversation", () => {
  it("loads once and keeps a message sent while it was loading", async () => {
    const saved: ChatMessage = { id: 1, role: "user", content: "old", ts: 0, summarized: true };
    const held = deferred<ChatMessage[]>();
    vi.mocked(getAllMessages).mockReturnValueOnce(held.promise);
    generateMock.mockResolvedValue(reply("ok"));

    loadMessages();
    loadMessages();
    expect(getAllMessages).toHaveBeenCalledTimes(1);

    send("new", deps());
    await settle();
    held.resolve([saved]);
    await settle();

    const snap = getSnapshot();
    expect(snap.loaded).toBe(true);
    expect(snap.messages[0]).toEqual(saved);
    expect(snap.messages.map((m) => m.content)).toEqual(["old", "new", "ok"]);
  });
});
