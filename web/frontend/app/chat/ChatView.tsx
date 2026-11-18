"use client";

import { Button, PageTitle, Tag, Textarea } from "@/components/ui";
import { detectCrisis, type ChatMode } from "@haven/backend";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { toHavenError } from "@/lib/ai";
import { plainText } from "@/lib/format";
import {
  buildCloudRequest,
  commitTurn,
  CrisisDetectedError,
  dismissMemory,
  generateReply,
  saveCloudReply,
  suggestMemory,
} from "@/lib/chatService";
import { addFact, getMode, setMode as saveMode } from "@/lib/storage";
import { addMessage, getAllMessages } from "@/lib/db";
import type { ChatMessage } from "@/lib/types";
import { useAI } from "@/components/AIProvider";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useCrisis } from "@/components/CrisisProvider";
import { useShield } from "@/components/ShieldProvider";

const DECLINED_HELP =
  "No problem, nothing was sent. To chat privately, use desktop Chrome 139 or newer, turn on chrome://flags/#prompt-api-for-gemini-nano-multimodal-input, restart Chrome, then come back and press Start chatting.";
const CANCELLED = "Okay, I didn't send anything. Your message is still only on this device.";

function TypingIndicator() {
  return (
    <div className="flex justify-start" role="status" aria-label="Haven is typing">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-bubble-bot px-4 py-3.5">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.error || m.notice) {
    return (
      <div className="flex justify-start">
        <p
          role={m.error ? "alert" : "status"}
          className={`max-w-[min(85%,36rem)] rounded-2xl rounded-bl-md px-4 py-3 ${m.error ? "bg-danger-bg text-danger-ink" : "bg-accent-soft"}`}
        >
          {m.content}
        </p>
      </div>
    );
  }
  const user = m.role === "user";
  const cloud = !user && m.source === "cloud";
  return (
    <div className={`flex ${user ? "justify-end" : "justify-start"}`}>
      {/* About 65 characters per line on wide screens (36rem scales with the text size); 85% on phones. */}
      <div className="max-w-[min(85%,36rem)]">
        {/* A cloud reply carries its tag beside the bubble, or under it on a narrow screen. */}
        <div
          className={
            cloud ? "flex flex-col items-start gap-1 sm:flex-row sm:items-end sm:gap-2" : ""
          }
        >
          <p
            className={`min-w-0 rounded-2xl px-4 py-3 whitespace-pre-wrap ${
              user
                ? "rounded-br-md bg-bubble-user text-bubble-user-ink"
                : "rounded-bl-md bg-bubble-bot"
            }`}
          >
            <span className="sr-only">{user ? "You: " : "Haven: "}</span>
            {user ? m.content : plainText(m.content)}
          </p>
          {cloud && (
            <span className="shrink-0">
              <Tag kind="cloudReply" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const MODES: Array<{ id: ChatMode; label: string; hint: string }> = [
  { id: "listen", label: "Just listen", hint: "Haven reflects and asks, without advice" },
  { id: "help", label: "Help me think", hint: "Haven asks what you've tried, then offers an idea" },
];

function ModeChips({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="How should Haven reply?"
      className="mb-2 flex flex-wrap gap-2"
    >
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={mode === m.id}
          title={m.hint}
          onClick={() => onChange(m.id)}
          className={`rounded-full border px-3.5 py-1.5 text-sm ${
            mode === m.id
              ? "border-transparent bg-accent-soft font-medium text-ink"
              : "border-line text-muted hover:bg-surface hover:text-ink"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** A memory Haven noticed. Nothing is saved unless the person presses Keep. */
function MemoryNote({
  text,
  onKeep,
  onSkip,
}: {
  text: string;
  onKeep: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex justify-start">
      <div
        role="group"
        aria-label="Suggested memory"
        className="flex max-w-[min(85%,36rem)] flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-2.5 text-sm"
      >
        <span>
          <span className="text-muted">Remember: </span>
          {text}?
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            onClick={onKeep}
            className="rounded-lg bg-accent-soft px-3 py-1 font-medium hover:bg-line"
          >
            Keep
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="rounded-lg px-3 py-1 text-muted hover:bg-line hover:text-ink"
          >
            Not now
          </button>
        </span>
      </div>
    </div>
  );
}

export default function ChatView() {
  const { phase, cloudMode, markSource } = useAI();
  const { triggerCrisis } = useCrisis();
  const { runShielded } = useShield();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [partial, setPartial] = useState("");
  const [consent, setConsent] = useState<((ok: boolean) => void) | null>(null);
  const [mode, setModeState] = useState<ChatMode>("listen");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  /** Bumped on every send, so a memory suggestion for an older message is dropped. */
  const sendSeq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    getAllMessages()
      .then((m) => alive && setMessages(m))
      .catch(() => undefined)
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // The saved mode lives in localStorage, which only exists in the browser.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState(getMode());
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking, partial]);

  const push = useCallback((m: ChatMessage) => setMessages((prev) => [...prev, m]), []);
  const notice = useCallback(
    (content: string, kind: "error" | "notice" = "notice") =>
      push({ role: "assistant", content, ts: Date.now(), summarized: false, [kind]: true }),
    [push],
  );

  /** Cloud path: ask permission, run the privacy shield preview, and only then send masked text. */
  const cloudFlow = useCallback(
    async (text: string, before: ChatMessage[]): Promise<ChatMessage | null> => {
      const ok = await new Promise<boolean>((resolve) => setConsent(() => resolve));
      setConsent(null);
      if (!ok) {
        notice(DECLINED_HELP);
        return null;
      }
      const { personalText, instruction, plan } = await buildCloudRequest(text, before);
      const result = await runShielded({
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
    },
    [notice, runShielded],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || thinking) return;
    // Crisis check runs FIRST, in plain code. No model is called, and the text is not stored,
    // so it can never be fed into a later prompt.
    setInput("");
    const seq = ++sendSeq.current;
    setSuggestion(null);
    if (detectCrisis(text).matched) {
      triggerCrisis();
      return;
    }
    setThinking(true);
    setPartial("");
    const before = messages.filter((m) => !m.error && !m.notice);
    try {
      const userMsg = await addMessage({
        role: "user",
        content: text,
        ts: Date.now(),
        summarized: false,
      });
      push(userMsg);

      let reply: ChatMessage | null = null;
      if (phase === "ready") {
        try {
          reply = await generateReply(text, before, setPartial);
          markSource("device");
          // Best-effort and on-device only: look for one lasting fact once the reply is done.
          // Dropped if the person has already sent their next message.
          void suggestMemory(text).then((fact) => {
            if (fact && sendSeq.current === seq) setSuggestion(fact);
          });
        } catch (e) {
          if (e instanceof CrisisDetectedError) throw e;
          if (toHavenError(e).kind !== "device_unavailable") throw e;
          // The private model failed: offer the cloud, with consent and the shield.
        }
      }
      if (!reply) reply = await cloudFlow(text, before);
      if (reply) push(reply);
    } catch (e) {
      if (e instanceof CrisisDetectedError) triggerCrisis();
      else notice(toHavenError(e).message, "error");
    } finally {
      setPartial("");
      setThinking(false);
      textareaRef.current?.focus();
    }
  }, [input, thinking, messages, phase, push, notice, cloudFlow, markSource, triggerCrisis]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-3xl px-4 pt-5">
        <PageTitle
          where={phase !== "ready" && cloudMode ? "cloud" : "private"}
          className="text-2xl"
        >
          Chat
        </PageTitle>
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-y-auto"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        <div className="mx-auto max-w-3xl space-y-3 px-4 py-6">
          {loaded && messages.length === 0 && (
            <div className="mx-auto mt-10 max-w-md rounded-2xl border border-line bg-peach p-6 text-center">
              <h2 className="text-xl font-medium">I&apos;m here when you&apos;re ready.</h2>
              <p className="mt-2 text-muted">
                Tell me what&apos;s on your mind, big or small. There&apos;s no right way to start.
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <Bubble key={m.id ?? `n${i}`} m={m} />
          ))}
          {thinking && partial && (
            <Bubble m={{ role: "assistant", content: partial, ts: 0, summarized: false }} />
          )}
          {thinking && !partial && !consent && <TypingIndicator />}
          {suggestion && !thinking && (
            <MemoryNote
              text={suggestion}
              onKeep={() => {
                addFact(suggestion, "suggested");
                setSuggestion(null);
              }}
              onSkip={() => {
                dismissMemory(suggestion);
                setSuggestion(null);
              }}
            />
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form onSubmit={onSubmit} className="border-t border-line bg-bg">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <ModeChips
            mode={mode}
            onChange={(m) => {
              setModeState(m);
              saveMode(m);
            }}
          />
          <div className="flex items-end gap-2">
            <label htmlFor="chat-input" className="sr-only">
              Message Haven
            </label>
            <Textarea
              radius="2xl"
              className="min-h-[3.25rem] flex-1 resize-none"
              id="chat-input"
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="Type how you're feeling…"
            />
            <Button type="submit" disabled={!input.trim() || thinking}>
              Send
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted">Enter to send · Shift+Enter for a new line</p>
        </div>
      </form>

      {consent && (
        <ConfirmDialog
          title="Use the cloud for this message?"
          confirmLabel="Yes, show me the preview"
          cancelLabel="No thanks"
          onConfirm={() => consent(true)}
          onCancel={() => consent(false)}
        >
          <p>
            Your device can&apos;t run the private model. Send this message to the cloud instead?
          </p>
          <p className="mt-2">
            You&apos;ll see exactly what the cloud would receive, with personal details hidden,
            before anything is sent.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
