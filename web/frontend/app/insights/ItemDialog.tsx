"use client";

import { Button } from "@/components/ui";
import Modal from "@/components/Modal";
import { formatDay } from "@/lib/journal";
import type { InsightItem } from "@/lib/insights";

/** The full text of one note, to read. A locked (crisis) note is never opened: it has no text. */
export default function ItemDialog({ item, onClose }: { item: InsightItem; onClose: () => void }) {
  const detail =
    item.kind === "journal"
      ? `Mood ${item.mood} of 10`
      : item.kind === "summary"
        ? "Summary of earlier chats"
        : "Your message";
  return (
    <Modal
      labelledBy="item-dialog-h"
      onRequestClose={onClose}
      dismissOnOutside
      // Some browsers don't focus a button when it is clicked, so name the one that opened this.
      fallbackFocus={() => document.getElementById(`read-${item.id}`)}
      // Plain and neutral like the cards in the list, with a clear edge against the dimmed page.
      className="border border-ink/25 bg-bg text-ink shadow-2xl"
    >
      <h2 id="item-dialog-h" className="text-2xl">
        {formatDay(item.day)}
      </h2>
      <p className="mt-1 font-medium">{detail}</p>
      {/* A very long note scrolls here, so the card never grows taller than the window. */}
      <div className="mt-4 max-h-[50dvh] overflow-y-auto" tabIndex={0} aria-label="Full text">
        <p className="text-lg leading-relaxed break-words whitespace-pre-wrap">{item.full}</p>
      </div>
      {item.truncated && (
        <p className="mt-3 text-sm text-muted">Only the first {item.limitWords} words are sent.</p>
      )}
      <div className="mt-6">
        <Button data-modal-focus variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
