"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { HavenAIError, toHavenError } from "@/lib/ai";
import { isCloudEnabled } from "@/lib/remoteConfig";
import { prepareShield, sendMasked, type ShieldPrep } from "@/lib/shield";
import { useAI } from "./AIProvider";
import PreviewDialog from "./PreviewDialog";

export interface ShieldRequest {
  /** The personal text to protect and send. */
  text: string;
  /** Non-personal instruction for the cloud model (sent as-is). */
  instruction: string;
  title?: string;
  /**
   * If given, the reply streams in and this receives the text so far (originals restored, nothing
   * half-finished). The preview closes as soon as text starts to arrive.
   */
  onPartial?: (unmaskedSoFar: string) => void;
}
export interface ShieldResult {
  text: string;
  /** True if some placeholder in the reply couldn't be restored. */
  altered: boolean;
}

interface ShieldState {
  /**
   * Runs the whole privacy-shield flow: detect, mask, show the preview, and ONLY on confirm send the masked text.
   * Resolves with the un-masked reply, or null if the user cancelled. Throws HavenAIError on failure.
   */
  runShielded: (req: ShieldRequest) => Promise<ShieldResult | null>;
}

const Ctx = createContext<ShieldState | null>(null);

export function useShield(): ShieldState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShield must be used inside <ShieldProvider>");
  return v;
}

interface Session {
  req: ShieldRequest;
  prep: ShieldPrep | null;
  sending: boolean;
  error: string | null;
}

export default function ShieldProvider({ children }: { children: ReactNode }) {
  const { phase, markSource } = useAI();
  const [session, setSession] = useState<Session | null>(null);
  const resolver = useRef<((r: ShieldResult | null) => void) | null>(null);
  const rejecter = useRef<((e: unknown) => void) | null>(null);
  const localReady = phase === "ready";

  const finish = useCallback((r: ShieldResult | null) => {
    resolver.current?.(r);
    resolver.current = null;
    rejecter.current = null;
    setSession(null);
  }, []);

  const runShielded = useCallback(
    async (req: ShieldRequest) => {
      if (!(await isCloudEnabled())) {
        throw new HavenAIError(
          "unavailable",
          "Cloud features are switched off right now. Haven is staying fully on your device.",
        );
      }
      return new Promise<ShieldResult | null>((resolve, reject) => {
        resolver.current = resolve;
        rejecter.current = reject;
        setSession({ req, prep: null, sending: false, error: null });
        prepareShield(req.text, localReady).then(
          (prep) => setSession((s) => (s ? { ...s, prep } : s)),
          () =>
            setSession((s) =>
              s ? { ...s, prep: { original: req.text, entries: [], weak: true } } : s,
            ),
        );
      });
    },
    [localReady],
  );

  const onSend = useCallback(
    async (masked: string, map: Record<string, string>) => {
      const req = session?.req;
      if (!req) return;
      setSession((s) => (s ? { ...s, sending: true, error: null } : s));
      // When streaming, the preview closes at the first text, so the person watches it being written.
      let streaming = false;
      const onPartial = req.onPartial
        ? (soFar: string) => {
            if (!streaming) {
              streaming = true;
              setSession(null);
            }
            req.onPartial?.(soFar);
          }
        : undefined;
      try {
        const r = await sendMasked(masked, map, req.instruction, onPartial);
        markSource("cloud");
        finish({ text: r.text, altered: r.altered });
      } catch (e) {
        if (streaming) {
          // The preview is already gone, so the failure goes back to whoever asked.
          const reject = rejecter.current;
          resolver.current = null;
          rejecter.current = null;
          reject?.(toHavenError(e));
        } else {
          setSession((s) => (s ? { ...s, sending: false, error: toHavenError(e).message } : s));
        }
      }
    },
    [session, markSource, finish],
  );

  const value = useMemo(() => ({ runShielded }), [runShielded]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {session && (
        <PreviewDialog
          title={session.req.title ?? "Review what the cloud will see"}
          prep={session.prep}
          sending={session.sending}
          error={session.error}
          onSend={onSend}
          onCancel={() => finish(null)}
        />
      )}
    </Ctx.Provider>
  );
}
