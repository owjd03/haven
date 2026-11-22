// The chat's running state, kept outside the Chat page.
//
// The page is removed when someone opens another tab of the app. If the reply lived in the page, a
// reply that is still being written would be forgotten by the screen (the on-device model keeps
// going and the reply is saved, but nothing shows it). Here it survives, and the page only displays
// it. This module has no React in it, so it is easy to test.

import { detectCrisis } from "@haven/backend";
import { toHavenError } from "./ai";
import {
  buildCloudRequest,
  commitTurn,
  CrisisDetectedError,
  generateReply,
  saveCloudReply,
  suggestMemory,
} from "./chatService";
import { addMessage, getAllMessages } from "./db";
import type { ChatMessage } from "./types";

const DECLINED_HELP =
  "No problem, nothing was sent. To chat privately, use desktop Chrome 139 or newer, turn on chrome://flags/#prompt-api-for-gemini-nano-multimodal-input, restart Chrome, then come back and press Start chatting.";
const CANCELLED = "Okay, I didn't send anything. Your message is still only on this device.";

export interface ChatSnapshot {
  /** Saved messages plus short notices and errors (those two are never saved). */
  messages: ChatMessage[];
  loaded: boolean;
  /** A reply is being written. */
  thinking: boolean;
  /** The reply so far, while it streams in. */
  partial: string;
  /** Waiting for the person to say yes or no to using the cloud for this message. */
  askingConsent: boolean;
  /** One lasting fact Haven noticed. Nothing is kept unless the person says so. */
  suggestion: string | null;
}

/** What `send` needs from the app. They come from the providers, which live above every page. */
export interface SendDeps {
  /** The on-device model is ready. */
  deviceReady: boolean;
  triggerCrisis: () => void;
  markSource: (s: "device" | "cloud") => void;
  runShielded: (req: {
    text: string;
    instruction: string;
    title?: string;
  }) => Promise<{ text: string; altered: boolean } | null>;
}

const INITIAL: ChatSnapshot = {
  messages: [],
  loaded: false,
  thinking: false,
  partial: "",
  askingConsent: false,
  suggestion: null,
};

let state: ChatSnapshot = INITIAL;
const listeners = new Set<() => void>();
let consentResolver: ((ok: boolean) => void) | null = null;
let loadStarted = false;
/** Bumped on every send, so a memory suggestion for an older message is dropped. */
let sendSeq = 0;

function set(patch: Partial<ChatSnapshot>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ChatSnapshot {
  return state;
}

export function getServerSnapshot(): ChatSnapshot {
  return INITIAL;
}

/** Loads the saved conversation once. A message added before the load finishes is kept. */
export function loadMessages(): void {
  if (loadStarted) return;
  loadStarted = true;
  getAllMessages()
    .then((saved) => {
      const have = new Set(state.messages.map((m) => m.id).filter((id) => id !== undefined));
      set({
        messages: [
          ...saved.filter((m) => m.id === undefined || !have.has(m.id)),
          ...state.messages,
        ],
      });
    })
    .catch(() => undefined)
    .finally(() => set({ loaded: true }));
}

function push(m: ChatMessage) {
  set({ messages: [...state.messages, m] });
}

function notice(content: string, kind: "error" | "notice" = "notice") {
  push({ role: "assistant", content, ts: Date.now(), summarized: false, [kind]: true });
}

/** The person answers the cloud question. */
export function answerConsent(ok: boolean): void {
  consentResolver?.(ok);
  consentResolver = null;
  set({ askingConsent: false });
}

/** The Chat page is gone. The cloud question needs a person, so it counts as "no". */
export function leaveChat(): void {
  if (consentResolver) answerConsent(false);
}

export function clearSuggestion(): void {
  set({ suggestion: null });
}

/** Cloud path: ask permission, run the privacy shield preview, and only then send masked text. */
async function cloudFlow(
  text: string,
  before: ChatMessage[],
  deps: SendDeps,
): Promise<ChatMessage | null> {
  const ok = await new Promise<boolean>((resolve) => {
    consentResolver = resolve;
    set({ askingConsent: true });
  });
  if (!ok) {
    notice(DECLINED_HELP);
    return null;
  }
  const { personalText, instruction, plan } = await buildCloudRequest(text, before);
  const result = await deps.runShielded({
    text: personalText,
    instruction,
    title: "Review what the cloud will see",
  });
  if (!result) {
    notice(CANCELLED);
    return null;
  }
  if (result.altered)
    notice("Some private details in the reply couldn't be restored, so I left them generic.");
  const saved = await saveCloudReply(result.text, plan.mode);
  commitTurn(plan);
  return saved;
}

async function runTurn(text: string, seq: number, deps: SendDeps): Promise<void> {
  const before = state.messages.filter((m) => !m.error && !m.notice);
  try {
    const userMsg = await addMessage({
      role: "user",
      content: text,
      ts: Date.now(),
      summarized: false,
    });
    push(userMsg);

    let reply: ChatMessage | null = null;
    if (deps.deviceReady) {
      try {
        reply = await generateReply(text, before, (partial) => set({ partial }));
        deps.markSource("device");
        // Best-effort and on-device only: look for one lasting fact once the reply is done.
        // Dropped if the person has already sent their next message.
        void suggestMemory(text).then((fact) => {
          if (fact && sendSeq === seq) set({ suggestion: fact });
        });
      } catch (e) {
        if (e instanceof CrisisDetectedError) throw e;
        if (toHavenError(e).kind !== "device_unavailable") throw e;
        // The private model failed: offer the cloud, with consent and the shield.
      }
    }
    if (!reply) reply = await cloudFlow(text, before, deps);
    if (reply) push(reply);
  } catch (e) {
    if (e instanceof CrisisDetectedError) deps.triggerCrisis();
    else notice(toHavenError(e).message, "error");
  } finally {
    set({ partial: "", thinking: false });
  }
}

/**
 * Starts a reply to a new message. Returns false (and does nothing) if the text is empty or a reply
 * is already running. The work carries on whether or not the Chat page is on screen.
 */
export function send(rawText: string, deps: SendDeps): boolean {
  const text = rawText.trim();
  if (!text || state.thinking) return false;
  const seq = ++sendSeq;
  set({ suggestion: null });
  // Crisis check runs FIRST, in plain code. No model is called, and the text is not stored,
  // so it can never be fed into a later prompt.
  if (detectCrisis(text).matched) {
    deps.triggerCrisis();
    return true;
  }
  set({ thinking: true, partial: "" });
  void runTurn(text, seq, deps);
  return true;
}

/** For tests only: back to a fresh start. */
export function resetChatSessionForTests(): void {
  state = INITIAL;
  consentResolver = null;
  loadStarted = false;
  sendSeq = 0;
  listeners.clear();
}
