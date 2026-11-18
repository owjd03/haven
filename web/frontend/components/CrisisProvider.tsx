"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import CrisisView, { type CrisisVariant } from "./CrisisView";

interface CrisisState {
  /**
   * Show the full-screen support view. Call this instead of any model when crisis language is detected.
   * Pass "browse" for someone who just wants the support lines (no "what you wrote" wording).
   */
  triggerCrisis: (variant?: CrisisVariant) => void;
}

const Ctx = createContext<CrisisState | null>(null);

export function useCrisis(): CrisisState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCrisis must be used inside <CrisisProvider>");
  return v;
}

export default function CrisisProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<CrisisVariant | null>(null);
  const triggerCrisis = useCallback((variant: CrisisVariant = "alert") => setOpen(variant), []);
  const value = useMemo(() => ({ triggerCrisis }), [triggerCrisis]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {open && <CrisisView variant={open} onClose={() => setOpen(null)} />}
    </Ctx.Provider>
  );
}
