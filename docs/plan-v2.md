# Haven — Plan v2: Journal

Status: **all five phases implemented** (the recommended answer was taken for every open decision). Still to do by a person: try the real flows in Chrome (see the checklist), including journal insights with the real cloud model, which was not exercised in automated checks.

As built, one detail differs from the draft below: the low-mood note needs **at least 2 entries** in the range (not a single bad day) and an average of 3 or lower.

Deadline reminder: #BuildHybridAI submission closes **Mon Nov 30, 2026, 2:00 PM PT**. A finished, polished feature beats a bigger half-done one, so the phases are ordered so that the app is shippable after each one.

## Summary

A new **Journal** tab, placed to the left of Chat. People write down how they're feeling, pick the day it's about, and rate their mood from 1 to 10.

- **Writing and reading entries is private.** Entries are saved only in this browser (IndexedDB), like chats. No AI reads them unless the user asks.
- **Journal insights is a cloud feature, used only when the user asks.** If the user wants, the cloud model reads their recent entries (after the privacy shield and preview) and suggests small, gentle things they could try.
- **Weekly reflection becomes an overall reflection.** It uses the last 7 days of both chat and journal.

## Does this fit Haven's rules?

Yes. It follows the same pattern as everything else:

| Haven rule | How the Journal follows it |
| --- | --- |
| Private by default | Entries and mood scores never leave the device unless the user starts Journal insights or Weekly reflection |
| Cloud only with consent, one use at a time | Insights runs only from a button press, then shows the shield preview; nothing is sent until **Send to cloud** |
| Privacy shield | Entry text is masked (names, places, schools, contacts) before the preview, same as Weekly reflection |
| Crisis rule (plain code, before any model) | Every entry is checked with `detectCrisis` when saved. Crisis-flagged entries are **never** sent to any AI, including insights and the weekly reflection |
| Not therapy, never diagnose | The mood score is the user's own number, not a measurement. Haven never labels a pattern as a condition. Prompts forbid diagnosis and medical advice |
| No pressure | No streaks, reminders, "you missed a day", mood-coloured red/green scales, or goals. Skipping days is normal and never mentioned |
| Status visibility | The page title carries **Private · on your device**; the insights section carries its own **Cloud · asks you first** tag |

The one new sensitivity is that a mood score history is health-adjacent data. It stays local. It's included in backups and wiped by **Delete everything**. When insights runs, the preview shows the scores exactly as they'll be sent.

## User experience

### Journal page (`/journal`, private)

- **New entry form at the top:**
  - **Day:** defaults to today; can be set to an earlier day (no future dates).
  - **How are you feeling, out of 10?** Ten plainly labelled buttons, 1 to 10, with end labels "1 = really low" and "10 = really good". Neutral colour only; the selected one uses the normal selected style. No emoji faces.
  - **What's on your mind?** A large text area, with a real label (not just placeholder text).
  - **Save entry** (primary button). The text "Saved only on this device" sits beside it.
- **Past entries below**, newest day first, grouped by day: the day, the mood as "Mood 6 of 10", and the text. Each entry has **Edit** and **Delete**, and delete asks to confirm.
- **Empty state:** "Nothing here yet. Write as much or as little as you like, whenever it helps." No nudge to come back.
- **Journal insights section** at the bottom (cloud, described below).

### Journal insights (cloud, on request)

1. The user picks the range: **last 7 days** or **last 30 days** (default 7).
2. Haven gathers those entries on the device, newest first, up to a word budget. Crisis-flagged entries are left out, and the screen says so plainly ("1 entry was left out and is never sent to any AI").
3. The privacy shield masks the text, and the user sees the preview of exactly what goes: day, mood score, masked text.
4. The cloud model replies with:
   - patterns it notices between moods and what was written;
   - what seemed to help on better days, in the user's own words;
   - two or three small, gentle suggestions;
   - a mention of professional support only when it truly fits.
5. **Grounding:** before sending, Haven runs the existing coping-card retrieval on the entries and adds up to two relevant card techniques to the instruction. Card text is generic, not personal, so it's safe to send.
6. **Low-mood note (plain code, not AI):** if the average mood in the range is 3 or lower, Haven shows a calm note above the result: "It looks like it's been a hard stretch. Talking to someone you trust, or a counselor, can help." It includes a link to the crisis lines screen. This doesn't depend on the model.
7. The result is shown on screen with **Copy**. It's not saved (same as Weekly reflection).

### Weekly reflection changes

- `gatherWeek` adds journal entries from the last 7 days to each day block: `Journal (mood 4/10): <text, trimmed>`.
- The word budget (700) is shared: up to about 60% for journal text when both sources exist, so neither crowds out the other.
- Crisis-flagged entries are excluded.
- The empty state becomes: "Nothing to reflect on yet. Chat or write in your journal for a few days, then come back."
- The instruction mentions that mood scores are the user's own ratings and must not be interpreted clinically.

### Navigation

`Journal · Chat · About me · Weekly reflection · Write a message · Settings`

## Technical design

### Data

New type in `lib/types.ts`:

```ts
export interface JournalEntry {
  id?: number;
  day: string;        // "YYYY-MM-DD", the day the entry is about
  mood: number;       // integer 1–10
  text: string;       // max 10,000 characters
  createdAt: number;
  updatedAt: number;
  /** Set by the crisis check on save; flagged entries are never sent to any model. */
  crisisFlag?: boolean;
}
```

IndexedDB (`lib/db.ts`):

- `DB_VERSION` 1 → 2, adding a `journal` store with `keyPath: "id"`, autoIncrement, and index `by-day`.
- **The upgrade must branch on `oldVersion`.** Today's `upgrade()` creates the v1 stores unconditionally, which would throw for existing users. New shape: `if (oldVersion < 1) { messages + summaries }`, `if (oldVersion < 2) { journal }`.
- New helpers:
  - `addJournalEntry` and `updateJournalEntry`
  - `deleteJournalEntry` and `getJournalEntries` (newest first)
  - `getJournalSince(day)`
- `clearAllData` and `replaceAll` include the journal.

Backup (`web/backend/src/backup.ts`):

- `BACKUP_VERSION` 1 → 2, adding an optional `journal` array.
- Strict validation:
  - `day` matches `^\d{4}-\d{2}-\d{2}$` and is a real date;
  - `mood` is an integer 1–10;
  - `text` is at most 10,000 characters;
  - the timestamps are numbers.
- Version 1 files still import (journal treated as empty).

Data tools (`lib/dataTransfer.ts`, `PrivacyView.tsx`):

- Export, restore and delete everything all cover the journal.
- The "How Haven handles your data" page lists journal entries and mood scores under "Stays on your device", and Journal insights under "Can go to the cloud, only when you choose".

### Logic

- **New `lib/journal.ts`:**
  - `gatherJournal(range, now)`: returns `{ text, entries, excluded, averageMood }`, with a budget of about 900 words, the newest entries first, each trimmed to about 120 words.
  - `JOURNAL_INSIGHT_INSTRUCTION`.
  - `insightCards(text)`, which uses `retrieve()` from `@haven/backend`.
- **Insights are sent through the existing `useShield().runShielded`.** No new cloud path, so App Check, the Remote Config kill switch (`cloud_enabled`) and the 503 retry all apply automatically.
- **Crisis check on save:** `detectCrisis(text)` runs before writing.
- **`lib/reflection.ts`:** `gatherWeek` reads the journal too.
- **On-device chat does not read the journal** in v2. A user may write things in a journal they don't want brought into chat. This could become an opt-in later.

### UI

- **New route:** `app/journal/page.tsx` plus `layout.tsx` for the title, using `PageTitle where="private"`, `Button`, `Textarea`, `ConfirmDialog` and `Tag kind="cloud"` on the insights `h2`.
- **Nav:** add Journal as the first nav item in `Shell.tsx`.
- **Mood buttons:**
  - a `radiogroup` with arrow-key support;
  - each option is a real radio input with a visible label;
  - the selection is visible by more than colour (border and weight);
  - at phone width the buttons wrap onto two rows of 5.

## Testing

- **Backend (`web/backend/tests`):** backup v2 validation, covering:
  - a valid journal;
  - a bad day string;
  - mood 0 and 11 and 5.5;
  - text that's too long;
  - a v1 file still accepted.
- **Frontend (`web/frontend/tests`):**
  - `gatherJournal` budget and ordering;
  - crisis-flagged entries excluded and counted;
  - the average mood;
  - `gatherWeek` merging chat and journal by day within the 700-word budget;
  - the insights flow never calls a model for flagged text.
- **Migration test:** a v1 database opens as v2 and keeps its messages. This uses `fake-indexeddb` as a dev dependency, if needed.
- **Manual:**
  - write, edit and delete entries;
  - a crisis phrase in an entry;
  - insights with the preview;
  - the merged weekly reflection;
  - export, then delete, then restore;
  - dark mode and the larger text size;
  - keyboard only.
- **Screenshots:** extend `tools/shots/shoot.mjs` with `journal`, plus the height and scroller probe.

## Phases (stop after each for review and go-ahead)

1. **Data layer.** Type, IndexedDB v2 migration, journal CRUD helpers, backup v2 and validation, export/restore/delete coverage. Tests. *No UI change yet; the app keeps working.*
2. **Journal page (private).** Nav item, entry form with day and mood, past entries with edit and delete, crisis check on save, empty state, private tag. Screenshots in light, dark and phone width.
3. **Journal insights (cloud).** Range picker, gather with budget and exclusions, coping-card grounding, shield preview, instruction, low-mood note in plain code, result with copy. Tests.
4. **Overall weekly reflection.** Merge the journal into `gatherWeek`, shared budget, updated copy and instruction. Tests.
5. **Docs and polish.**
   - README (features table, privacy model, test count).
   - The in-app privacy page.
   - `docs/hackathon-checklist.md`.
   - An accessibility pass.
   - A final screenshot run.

Rough size: phases 1, 2 and 4 are about half a day each; phase 3 is about a day; phase 5 is a few hours. That leaves comfortable buffer before Nov 30.

## Open decisions (recommended answer first)

1. **Tab position:** Journal is the first tab, left of Chat. *Recommended: yes.*
2. **Mood required?** Yes, every entry needs a 1–10 score. *Recommended: required, with nothing preselected so the user always picks.*
3. **Entries per day:** many entries per day allowed, grouped under the day. *Recommended: many.*
4. **Choosing the day:** today by default, past days allowed, no future days. *Recommended: yes.*
5. **Crisis language in an entry:** show the support screen first, keeping the draft in the editor (not saved yet). Then let the user choose **Save privately (never sent to any AI)** or **Discard**. Chat doesn't save crisis text, but deleting someone's journal writing could feel punishing, and journaling dark thoughts can itself be healthy. *Recommended: this choice, with the flagged entry excluded from all cloud features.*
6. **Insights range:** last 7 or 30 days, default 7. *Recommended: yes.*
7. **Save insight results?** Shown with Copy, not stored. *Recommended: not stored, matching Weekly reflection.*
8. **Mood chart:** not in v2. Even a soft chart can turn into self-scoring pressure. Past entries already show each score. *Recommended: no chart; reconsider after user feedback.*
9. **Chat reading the journal:** no, the journal stays separate from chat. *Recommended: no in v2.*

## Addendum: sticky-note board (v2.1)

Decided in a follow-up grilling session, then built. Everything below was agreed with a "yes".

- **Board, not list.** Past entries are sticky notes in an auto-arranged grid (3 across on a laptop, 2 on a tablet, 1 on a phone), grouped under day headings. No dragging: it's hard to make keyboard-friendly and would need saved positions.
- **Creating a note.** A **New note** button, and a click or tap on any empty part of the board (the board is at least 60% of the screen tall, so there is always empty space). Both open the same popup, with the day set to today. Clicking a note opens that note instead.
- **One popup for a note's whole life.** Write, read, edit and delete all happen in the popup. The page opens on the board, not on a big form.
- **Paper colour.** Five soft colours (butter, peach, sage, sky, lilac), chosen in the popup, and the paper recolours live. Colour never encodes mood; the mood is always written as text. Stored as an optional `color` field (backup stays version 2; unknown colours are rejected). Older notes get a colour from a fixed rotation by id, so no migration. Every colour is contrast-tested against its text in light and dark.
- **Light playfulness only.** A tiny fixed tilt per note (at most 1.5 degrees, straightening on hover or focus), a soft shadow, and a 200ms fade-in for a newly added note. All of it is off for people who prefer reduced motion. No sounds, confetti or bounce.
- **Typed words are protected.** Outside-click is ignored once there is text. Cancel or Esc asks "Discard this note?" first (the answers are "Discard" and "Keep writing"). An empty popup closes freely.
- **Crisis rule unchanged.** Crisis language in a note shows the support screen over the popup; the note stays unsaved with the "Save privately / Discard" choice. It never reaches any AI.
- **Insights stay separate.** Journal insights remain their own section below the board, with the same cloud tag and shield preview.
- **Keyboard and screen readers.** Each note is a real button (its accessible name starts with the day). The popup is a real dialog: focus moves in and stays in, Esc closes, and focus returns to what opened it (or the New note button after an empty-space click). Clicking empty space is a bonus for mouse and touch; the button is the path for everyone.

One difference from the decision text: on the board a note shows "Mood 4 of 10" and the first five lines, and the day comes from its day heading (it is also read out as part of the note's name), so the day isn't printed twice on every note. The full day is shown when you open the note.

### Follow-up: no day picker

The Day field was removed from the popup. A new note is dated **today** automatically (worked out at the moment you press Save), and the date is shown as a plain label. An existing note keeps the day it was written, and editing never changes it. The `day` field and its validation stay in the data and backups, so older entries and backups work unchanged. This replaces the earlier "past days allowed, no future days" rule for creating notes.
