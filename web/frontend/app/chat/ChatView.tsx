"use client";

import { Button, PageTitle, Tag, Textarea } from "@/components/ui";
import type { ChatMode } from "@haven/backend";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { plainText } from "@/lib/format";
import { dismissMemory } from "@/lib/chatService";
import {
  answerConsent,
  clearSuggestion,
  getServerSnapshot,
  getSnapshot,
  leaveChat,
  loadMessages,
  send as sendMessage,
  subscribe,
} from "@/lib/chatSession";
import { addFact, getMode, setMode as saveMode } from "@/lib/storage";
import type { ChatMessage } from "@/lib/types";
import { useAI } from "@/components/AIProvider";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useCrisis } from "@/components/CrisisProvider";
import { useShield } from "@/components/ShieldProvider";

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
  // The conversation and any running reply live in lib/chatSession.ts, so they survive a switch to
  // another tab of the app. This page only shows them.
  const { messages, loaded, thinking, partial, askingConsent, suggestion } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [input, setInput] = useState("");
  const [mode, setModeState] = useState<ChatMode>("listen");
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wasThinking = useRef(false);

  useEffect(() => {
    loadMessages();
    // Leaving the page while the cloud question is open counts as "no": nothing is sent.
    return leaveChat;
  }, []);

  // The saved mode lives in localStorage, which only exists in the browser.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState(getMode());
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking, partial]);

  // Put the cursor back in the box when a reply you were watching finishes.
  useEffect(() => {
    if (wasThinking.current && !thinking) textareaRef.current?.focus();
    wasThinking.current = thinking;
  }, [thinking]);

  function send() {
    const accepted = sendMessage(input, {
      deviceReady: phase === "ready",
      triggerCrisis,
      markSource,
      runShielded,
    });
    if (accepted) setInput("");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
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
          {thinking && !partial && !askingConsent && <TypingIndicator />}
          {suggestion && !thinking && (
            <MemoryNote
              text={suggestion}
              onKeep={() => {
                addFact(suggestion, "suggested");
                clearSuggestion();
              }}
              onSkip={() => {
                dismissMemory(suggestion);
                clearSuggestion();
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

      {askingConsent && (
        <ConfirmDialog
          title="Use the cloud for this message?"
          confirmLabel="Yes, show me the preview"
          cancelLabel="No thanks"
          onConfirm={() => answerConsent(true)}
          onCancel={() => answerConsent(false)}
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
