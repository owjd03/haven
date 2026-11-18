"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { hasAgreed, setAgreed } from "@/lib/storage";
import Agreement from "./Agreement";
import { useAI } from "./AIProvider";

const agreedListeners = new Set<() => void>();
function subscribeAgreed(listener: () => void) {
  agreedListeners.add(listener);
  return () => void agreedListeners.delete(listener);
}

const NAV = [
  { href: "/journal", label: "Journal" },
  { href: "/chat", label: "Chat" },
  { href: "/profile", label: "About me" },
  { href: "/insights", label: "Insights" },
  { href: "/drafter", label: "Write a message" },
  { href: "/steps", label: "Small steps" },
  { href: "/settings", label: "Settings" },
];

function StatusBadge() {
  const { phase, activity, cloudMode } = useAI();
  let label = "Private model not started";
  let cloud = false;
  if (activity === "cloud") {
    label = "Using cloud, with your permission";
    cloud = true;
  } else if (phase === "ready") label = "Private, on your device";
  else if (cloudMode) {
    label = "Cloud only, asks each time";
    cloud = true;
  }
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${cloud ? "bg-warn-ink" : phase === "ready" ? "bg-ink" : "bg-muted/50"}`}
      />
      {label}
    </span>
  );
}

const DISCLAIMER =
  "Haven is a supportive companion, not a substitute for professional care. It can\u2019t diagnose or treat.";

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // null on the server and first paint, so the opening page never flashes for returning people.
  const agreed = useSyncExternalStore(subscribeAgreed, hasAgreed, () => null);

  if (agreed === null) return <div className="h-dvh" />;
  if (!agreed) {
    return (
      <div className="flex h-dvh flex-col">
        <header className="border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-3">
            <span className="font-serif text-2xl font-semibold tracking-tight">Haven</span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Agreement
            onAgree={() => {
              setAgreed();
              agreedListeners.forEach((l) => l());
            }}
          />
        </main>
      </div>
    );
  }
  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/" className="font-serif text-2xl font-semibold tracking-tight">
            Haven
          </Link>
          <nav
            aria-label="Main"
            className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto"
          >
            {NAV.map((n) => {
              const active = pathname === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 px-3 py-1.5 text-base underline-offset-8 transition-colors duration-150 ${active ? "font-medium text-ink underline decoration-2" : "text-muted hover:text-ink"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <StatusBadge />
        </div>
      </header>

      {pathname === "/chat" ? (
        <>
          <main className="relative min-h-0 flex-1">{children}</main>
          <footer className="border-t border-line px-4 py-2 text-center text-sm text-muted">
            {DISCLAIMER}
          </footer>
        </>
      ) : (
        <main className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col">
            <div className="flex-1">{children}</div>
            <p className="mx-auto max-w-2xl px-4 pt-6 pb-8 text-sm text-muted">{DISCLAIMER}</p>
          </div>
        </main>
      )}
    </div>
  );
}
