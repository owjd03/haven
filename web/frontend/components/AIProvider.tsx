"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getLocalStatus, initLocalModel, toHavenError, type LocalStatus } from "@/lib/ai";
import { isFirebaseConfigured } from "@/lib/firebase";
import { prefetchRemoteConfig } from "@/lib/remoteConfig";

export type ModelPhase = "idle" | "loading" | "ready" | "error";
export type Activity = "device" | "cloud" | null;

interface AIState {
  phase: ModelPhase;
  progress: number;
  error: string | null;
  localStatus: LocalStatus | "checking";
  configured: boolean;
  start: () => Promise<void>;
  /** The user chose to chat without the on-device model (every message then needs cloud consent). */
  cloudMode: boolean;
  enterCloudMode: () => void;
  /** Where the most recent AI work ran, for the status badge. */
  activity: Activity;
  markSource: (s: "device" | "cloud") => void;
}

const Ctx = createContext<AIState | null>(null);

export function useAI(): AIState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAI must be used inside <AIProvider>");
  return v;
}

export default function AIProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<ModelPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<LocalStatus | "checking">("checking");
  const [cloudMode, setCloudMode] = useState(false);
  const [activity, setActivity] = useState<Activity>(null);
  // NEXT_PUBLIC_* values are inlined at build time, so server and client agree.
  const configured = isFirebaseConfigured();

  useEffect(() => {
    let alive = true;
    getLocalStatus().then((s) => alive && setLocalStatus(s));
    prefetchRemoteConfig();
    return () => {
      alive = false;
    };
  }, []);

  // Must be called from a click: Chrome only allows model downloads after a user gesture.
  const start = useCallback(async () => {
    setError(null);
    setPhase("loading");
    setProgress(0);
    try {
      await initLocalModel((f) => setProgress(f));
      setProgress(1);
      setPhase("ready");
      setLocalStatus("available");
      setActivity("device");
    } catch (e) {
      setError(toHavenError(e).message);
      setPhase("error");
    }
  }, []);

  const enterCloudMode = useCallback(() => setCloudMode(true), []);
  const markSource = useCallback((s: "device" | "cloud") => setActivity(s), []);

  const value = useMemo(
    () => ({
      phase,
      progress,
      error,
      localStatus,
      configured,
      start,
      cloudMode,
      enterCloudMode,
      activity,
      markSource,
    }),
    [
      phase,
      progress,
      error,
      localStatus,
      configured,
      start,
      cloudMode,
      enterCloudMode,
      activity,
      markSource,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
