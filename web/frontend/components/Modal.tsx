"use client";

import { cx } from "@/components/ui";
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  /** id of the heading inside that names the dialog. */
  labelledBy: string;
  /** Esc and the Cancel/Close buttons call this. The parent decides whether to ask first. */
  onRequestClose: () => void;
  /** Whether clicking the dimmed area outside closes the dialog (off while there's unsaved text). */
  dismissOnOutside: boolean;
  /** True while another dialog (like "Discard?") is on top; focus comes back when it goes away. */
  suspended?: boolean;
  /** Where focus goes on close if the opener is gone or was just the page background. */
  fallbackFocus?: () => HTMLElement | null;
  /** Classes for the panel: width, colour, padding. */
  className?: string;
  children: ReactNode;
}

/**
 * A real dialog: focus moves in and is kept inside, Esc closes, and focus returns to
 * whatever opened it. Used for sticky notes, so a stray click can't lose what was typed.
 */
export default function Modal({
  labelledBy,
  onRequestClose,
  dismissOnOutside,
  suspended = false,
  fallbackFocus,
  className,
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pressedOutside = useRef(false);
  const fallbackRef = useRef(fallbackFocus);
  useEffect(() => {
    fallbackRef.current = fallbackFocus;
  });

  // Move focus in on open, and give it back on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    return () => {
      const back =
        opener && opener !== document.body && opener.isConnected ? opener : fallbackRef.current?.();
      back?.focus();
    };
  }, []);

  // When a dialog on top (like "Discard this note?") goes away, put focus back inside.
  useEffect(() => {
    const panel = panelRef.current;
    if (suspended || !panel || panel.contains(document.activeElement)) return;
    (panel.querySelector<HTMLElement>("[data-modal-focus]") ?? panel).focus();
  }, [suspended]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onRequestClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Only a press that starts AND ends on the dimmed area counts, so dragging to select text
  // inside the dialog and letting go outside doesn't close it.
  function onMouseDown(e: MouseEvent<HTMLDivElement>) {
    pressedOutside.current = e.target === e.currentTarget;
    // Pressing on the dimmed area must not pull focus out of the dialog, or Esc and Tab would stop working.
    if (pressedOutside.current) e.preventDefault();
  }
  function onClick(e: MouseEvent<HTMLDivElement>) {
    if (dismissOnOutside && pressedOutside.current && e.target === e.currentTarget) {
      onRequestClose();
    }
    pressedOutside.current = false;
  }

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-black/40" role="presentation">
      <div
        className="flex min-h-full items-center justify-center p-4"
        role="presentation"
        onMouseDown={onMouseDown}
        onClick={onClick}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={cx("w-full max-w-xl rounded-xl p-6 shadow-xl outline-none", className)}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
