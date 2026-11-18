# Haven — Plan v3: A chat that listens and remembers

Status: **all five phases implemented** on 2026-11-16 (241 tests pass). Every decision below was agreed that day (the recommended answer was taken each time). Still to do by a person: try the modes, the memory note and the cloud fallback in real Chrome, since Nano's actual replies were not exercised.

As built, three details differ from the draft below:
- The summary folds when 16 messages are unsummarized (8 kept verbatim, 8 folded), which is what "every 8 messages" means in practice.
- "Offer once" counts consecutive Listen replies, not replies on the same topic, because topic detection would need another model call.
- The shrink order gained two last steps (drop the "last talked" line, then shorten the new message) so the 450-word fallback really fits.

Deadline reminder: feature freeze **Tue Nov 25, 2026**. After that, only bug fixes, real-Chrome testing, the checklist and the demo video. Submission closes **Mon Nov 30, 2026, 2:00 PM PT**. The phases are ordered so the app can ship after each one.

## Summary

Two problems with chat today:

- **(c) It forgets context.** Details from a few messages ago get lost, and Haven never follows up on what you told it last time.
- **(d) The advice is generic.** Almost every reply offers a technique, even when the person just wants to be heard.

v3 fixes both without changing Haven's privacy line:

- **Two reply modes:** **Just listen** (the default) and **Help me think**. Advice and coping cards only appear in Help mode.
- **Better short-term memory:** a bigger prompt budget, and a structured summary that tracks open threads and what was already tried.
- **Time awareness:** Haven knows when you were last here, and can ask how things turned out once you write.
- **Suggested memories:** Nano spots one lasting fact on-device and asks *"Remember: exam on Friday?"* You choose **Keep** or **Not now**.

## What we decided not to do

- **No vector database and no embeddings.** There are only 92 cards, so a vector database brings nothing. Any embedding model would either send chat text to the cloud or run AI outside Firebase AI Logic, and Gemini Nano doesn't expose embeddings. Empathy comes from the prompt and from memory, not from retrieval.
- **No eval page with scripted conversations.** The failures are already known. A hidden `/dev/prompt` page shows the exact prompt instead (phase 2).
- **No automatic memory that saves silently, and the journal never feeds chat.** Both would break promises Haven already makes.

## Why it happens today (from the code)

| Problem | Cause | Where |
| --- | --- | --- |
| Forgets | Whole prompt capped at 450 words; each of the last 6 messages cut to 45 words | `frontend/lib/promptBuilder.ts:7-16` |
| Forgets | Summary only after 12 unsummarized messages; a loose paragraph, cut to 40 words when space is tight | `frontend/lib/chatService.ts:99-126`, `promptBuilder.ts:113-119` |
| Forgets | One endless conversation with no sense of time | `frontend/lib/db.ts` |
| Forgets | Profile facts typed in by hand only, capped at 60 words | `frontend/lib/storage.ts:34-46` |
| Generic | The system prompt forces validate, warn, suggest, ask on every reply, 5 to 8 sentences | `promptBuilder.ts:18-29` |
| Generic | A coping card is added whenever keywords match; small models tend to use whatever is in the prompt | `chatService.ts:39` |
| Generic | Nothing tracks what was already suggested or tried | n/a |

## Does this fit Haven's rules?

| Haven rule | How v3 follows it |
| --- | --- |
| Private by default | Modes, summaries, "last talked" and memory extraction all run on-device with Nano |
| Cloud only with consent | The cloud fallback gets the same modes and summary, still through the shield and preview. Memory extraction never runs in the cloud |
| No silent profiling | Every memory needs a **Keep** press. Kept facts are visible, editable and deletable in Profile |
| Crisis rule first | Unchanged. The crisis check runs before any model call, including extraction. Health and crisis details are never suggested as memories |
| Not therapy | The safety and "not a therapist" rules stay in both modes |
| No pressure | Haven only follows up after *you* write. No notifications or "we missed you" messages |

## User experience

### Reply modes
- Two chips above the chat input: **Just listen** (default on first run) and **Help me think**. The choice is saved on this device.
- **Just listen:** 2 to 4 sentences. Haven reflects something specific the person said, shows it understands, and asks one open question. No techniques and no advice.
- **Help me think:** a little longer. Haven first asks what they've already tried, then offers at most one idea built on their situation. It may use a coping card.
- **Auto-switch for one reply:** a clear ask ("what should I do", "any tips", "how do I") gets a Help reply. The saved mode doesn't change.
- **Offer once:** after about 3 listening turns on the same topic, Haven may ask once: *"Do you want some ideas, or is it better to just get it out?"*
- In both modes:
  - risk warnings stay
  - "many people feel this way" is allowed but not required
  - Haven doesn't open every reply the same way

### Time awareness
- After 6 or more hours away, the prompt includes *"Last talked: 3 days ago"* and the open threads. Haven's first reply can check in on one ("Last time the exam was coming up. How did it go?").

### Suggested memories
- A small note under a reply: *"Remember: exam on Friday?"* with **Keep** and **Not now**.
- At most one per message. "Not now" means the same fact isn't suggested again.
- Kept facts appear in Profile, marked as suggested, and can be edited or deleted like any other fact.

## Technical design

### Prompt (`frontend/lib/promptBuilder.ts`)
- Split `SYSTEM_INSTRUCTION` into a shared base (identity, safety, not a therapist, plain text, no pet names) plus a `LISTEN` and a `HELP` block.
- Budget: `MAX_WORDS` from 450 to **900**, `KEEP_RECENT` from 6 to **8**, recent message trim from 45 to **80** words, profile cap from 60 to **100** words.
- Add a "Last talked" line and the open threads when the gap is 6 hours or more.
- The shrink order stays. If Nano reports the input is too long, shrink further and retry once.

### Mode and intent (`web/backend`, pure TypeScript)
- `detectHelpIntent(text)`: a plain-code phrase list for clear asks, with unit tests.
- Track listen turns since the last mode change, for the "offer once" line.
- Mode is saved in localStorage next to the other settings.

### Coping cards (`chatService.ts`, `backend/src/retrieval.ts`)
- Call `retrieve` only in Help mode, or on an auto-switched reply.
- Skip card ids used in the last ~10 turns (stored on the Haven message).
- Skip cards whose technique matches the summary's "Tried / didn't help" line (simple keyword overlap).

### Structured summary (`chatService.ts`, `ai.ts`)
- The new summarize prompt fills in labelled lines: **Going on**, **Feeling**, **Tried / didn't help**, **Helped**, **Open threads**. It stays under about 120 words.
- `SUMMARY_THRESHOLD` goes from 12 to **8**.
- Old paragraph summaries stay readable. The new format starts from the next summary.

### Suggested memories (`chatService.ts`, `ai.ts`, `storage.ts`)
- The extraction call runs with `summaryModel` (on-device, steady sampling), **after** the reply has finished.
- It skips messages under about 8 words, and is dropped if the user has already sent the next message.
- The prompt asks for one lasting fact or none. The result is checked in plain code:
  - it gets a crisis check
  - health terms are blocked
  - it has a length cap
  - it's compared with existing facts and dismissed ones
- Facts get `source: "suggested" | "manual"`. Dismissed facts are kept as a small on-device list so they're never suggested again.

### Cloud fallback (`chatService.ts:61-84`)
- Same mode block, structured summary and "last talked" line. All personal parts still go through the shield.
- No memory extraction.

### Data and backups
- Backup version bump (v3). v1 and v2 files still load, and facts without `source` count as manual.
- **Delete everything** also clears dismissed facts and the saved mode.

### Dev only
- `/dev/prompt`, hidden in production builds: shows the exact final prompt for a sample conversation in each mode. No model call.

## Testing

- `promptBuilder.test.ts`:
  - both mode blocks are present and in the right order
  - Listen has no card section
  - the 900-word budget holds
  - shrink order
  - "last talked" appears only after 6 or more hours
- `retrieval.test.ts` / new `intent.test.ts`:
  - help intent phrases are found, and small talk isn't
  - recently used cards are skipped
- `chatService.test.ts`:
  - cards are retrieved only in Help mode
  - auto-switch doesn't change the saved mode
  - extraction runs after the reply, skips short messages, and never runs on the cloud path
- Memory tests:
  - crisis and health facts are never suggested
  - dismissed facts are never suggested again
  - duplicates are dropped
- Backup tests: v3 round trip, and v1 and v2 files still load.
- Existing crisis tests stay green: no model call (including extraction) on crisis text.

## Phases (stop after each for review and go-ahead)

1. **Reply modes (Nov 17–18).**
   - Split the system prompt into base + Listen + Help.
   - Mode chips, saved mode, help-intent detection, "offer once" line.
   - Cards only in Help mode, recently used cards skipped.
   - Tests.
   - *Fixes generic advice. Biggest visible change.*
2. **Memory budget and structured summary (Nov 19–20).**
   - 900-word budget, 8 messages at 80 words, 100-word profile cap, shrink-and-retry.
   - Structured summary every 8 messages.
   - "Tried" lines are used to skip cards.
   - `/dev/prompt` page.
   - Tests.
3. **Time awareness (Nov 21).** The "Last talked" line and open threads after a 6-hour gap. Tests. *Small.*
4. **Suggested memories (Nov 22–23).**
   - Background extraction with the rules above.
   - Keep / Not now note.
   - `source` flag and dismissed list.
   - Profile shows suggested facts.
   - Tests.
5. **Cloud parity, data and docs (Nov 24).**
   - Cloud fallback gets the modes, summary and "last talked" line.
   - Backup v3 with old versions still loading.
   - Delete-everything coverage.
   - README (features table, privacy model, test count), the in-app privacy page, `docs/hackathon-checklist.md`.
   - Final screenshot run.

**Feature freeze: Nov 25.** Nov 25 to 30 is for testing in real Chrome (the new modes, memory notes and cloud fallback with the real models), the existing checklist items and the demo video.

Rough size: phases 1, 2 and 4 are about a day and a half each, phase 3 about half a day, phase 5 about a day. This fits inside Nov 17 to 24 with a little buffer.

## Decisions log (all agreed 2026-11-16)

| # | Decision |
| --- | --- |
| Q2 | No vector database and no embeddings; keyword retrieval stays |
| Q3 | Everyday chat stays on-device; cloud only per use, with consent, through the shield |
| Q6 | Chatbot work Nov 17–24, feature freeze Nov 25 |
| Q10/Q12 | Stop forcing advice; Listen and Help modes |
| Q13 | Mode chips, Listen default, auto-switch for one reply on clear asks, offer once after about 3 listening turns |
| Q14 | Cards only in Help mode; skip recently used and already-tried techniques |
| Q15 | Budget 900 words, 8 messages at 80 words, profile 100 words, shrink and retry |
| Q16 | Structured summary every 8 messages |
| Q17 | "Last talked" after 6 hours or more; follow-up only after the user writes |
| Q11/Q18 | Suggested memories with Keep / Not now; no health or crisis facts |
| Q19 | No eval page; `/dev/prompt` preview instead |
| Q20 | Cloud fallback gets the same upgrades through the shield; no extraction in cloud |
| Q21 | Extraction after the reply, skips short messages, dropped if the user sends again |
| Q22 | Mode saved between visits; auto-switch doesn't change it |
| Q23 | Old summaries readable; `source: "suggested"`; backup v3, old files still load |

## Addendum: better on-device replies (v3.1)

Status: **all three phases implemented** (256 tests pass). Agreed on 2026-11-16 (Q9 to Q17, the recommended answer each time). Still to do by a person: try a few real conversations in Chrome in both modes and judge the tone.

As built, three details differ from the draft below:
- The shorter instructions came out at about 120 words for Listen and about 140 for Help (down from about 195 and 210), not 80. Cutting further would have removed safety or memory rules.
- The two examples are about 60 words each, not 40.
- The sentence cap keeps the closing sentence only when it is a question. Otherwise it keeps the first sentences up to the limit.

### Why

The first replies from Gemini Nano in real Chrome broke several rules from the instruction. A Help reply opened with "Haven: Oh honey", used a pet name, and ran to 8 sentences where 6 is the limit. The "Haven:" label and pet names were fixed in plain code right away (`cleanReply` in `frontend/lib/format.ts`, applied before saving and on display). v3.1 makes Nano follow the style more reliably, and catches what it still misses.

### What we decided not to do: "Ask for a deeper reply"

A button that re-sends a private reply's conversation to the cloud for a better answer was considered and **dropped**:

- It tells people the private reply is second best, which undercuts Haven's main promise.
- The moments someone wants a better answer are the hardest, most personal ones, which are exactly the messages that should stay on the device.
- Haven's hybrid split is already clear. The on-device model handles the live, personal conversation. The cloud handles heavier, long-context work the person starts on purpose (journal insights, weekly reflection, the message drafter), and stands in for chat only on devices that can't run the private model. All of it goes through the shield and preview.
- Most of what people (and judges) see is on-device replies, so improving those matters more.

**The cloud stays.** Only the deeper-reply button was dropped. Hybrid inference is the hackathon's core requirement, and the cloud features above are unchanged.

### Changes

1. **Shorter instruction.** Each mode drops from about 180 words to about 80. Small models follow a few short rules better than a long paragraph. Draft:
   - **Base:** "You are Haven, a warm companion for students and young adults going through something hard. You are not a therapist: never diagnose and never give medical advice. Write plain text only: no lists, bold, asterisks or emoji. No pet names. Don't start with 'Oh'. Start by reflecting something specific they said. If something from earlier is relevant, bring it up instead of asking again."
   - **Listen:** "They mostly want to be heard. Reply in 2 to 4 sentences. Show you understand how it feels. No advice or techniques unless they ask. If they mention something risky or harmful, gently name the likely consequences. End with one caring question."
   - **Help:** "They want help thinking it through. Reply in 4 to 6 sentences. Briefly acknowledge the feeling. If you don't know what they've tried, ask about it instead of advising. Otherwise offer one small, practical idea for their situation (a technique below, if it fits). If something risky comes up, gently warn about the consequences. Suggest a counselor or doctor only when it would truly help. End with at most one question."
2. **A reminder right before `Haven:`.** One line repeating the most-broken rules, which small models weigh most because they read it last. For example, Listen: "Remember: 2 to 4 sentences, no pet names, no advice, one question."
3. **One example per mode** (about 40 words), labelled "Example of the style only, not this person". It uses a topic unlike real messages, so Nano is unlikely to copy its details. Drafts:
   - **Listen.** User: "I missed my bus and then spilled coffee all over my notes. Everything is going wrong today." Haven: "Missing the bus and then losing your notes to coffee, all before the day has really started, is a rough way to begin. No wonder it feels like everything is going wrong. What's been the hardest part so far?"
   - **Help.** User: "I keep missing my morning bus even with two alarms. What can I do?" Haven: "That sounds frustrating, especially when you're already trying. Since the alarms get you up but not out the door, one small step could be laying out everything you need the night before. Would that fit your mornings?"
4. **Lower randomness.** The chat temperature goes from 0.8 to 0.6 (`frontend/lib/sampling.ts`). We can raise it again if replies start to sound samey.
5. **Sentence cap in plain code.** If a reply goes over the mode's limit (4 in Listen, 6 in Help), cut sentences from the middle, keeping the first (the reflection) and the last (usually the question). It runs with `cleanReply` before saving.
6. **Same cleanup on cloud replies.** The label, pet-name, "Oh" and sentence-cap fixes also apply to cloud fallback replies.
7. **Side tag on cloud replies.** Cloud fallback replies get a small "Cloud · you agreed" tag beside the bubble (under it at phone width), in the existing cloud tag style. It replaces the "via the cloud, with your permission" line. On-device replies have no tag, since that's the normal case.

### Budget check

The instruction shrinks by about 100 words, and the example plus reminder add about 60 back. The 900-word budget and the shrink order stay as they are. The example is dropped first if space runs out, before any recent messages.

### Testing

- Each mode's instruction is at most about 90 words. Both modes still carry the safety rules.
- The reminder sits right before `Haven:`, and the example is labelled and placed before the real conversation.
- The example is dropped before any recent message when over budget.
- Sentence cap: it keeps the first and last sentences, never cuts a reply that's within the limit, and handles "?", "!" and abbreviations like "e.g." without breaking.
- The cleanup runs on cloud replies too.
- The temperature for chat is 0.6.

### Phases (stop after each for review)

1. **Prompt (half a day).** The shorter instructions, the examples and the reminder line. Update `/dev/prompt` to show them. Tests.
2. **Guardrails (half a day).** The temperature change, the sentence cap, and cleanup on cloud replies. Tests.
3. **Side tag and docs (a few hours).** The cloud tag beside the bubble, plus the README and checklist.

About a day and a half in total, well before the Nov 25 freeze. After that, try a few real conversations in Chrome in both modes.

## Addendum: one Insights tab, and quieter listening (v3.2)

Status: **all four phases implemented** (268 tests pass; `/reflection` redirects to `/insights`, checked on a production build). Agreed on 2026-11-16 (Q1 to Q15 of that session, the recommended answer each time). Still to do by a person: try Insights with the real cloud model, and a few real chats in Chrome to judge the alternating questions.

As built, two details differ from the draft below:
- The "ideas or just get it out?" offer only happens on a turn that asks a question, so it never lands right after another question. It is still counted as the question for that turn.
- The notes rule added about 9 words, so the instructions are now about 128 words for Listen and about 152 for Help.

### Summary

- **Weekly reflection and Journal insights become one feature, Insights.** It takes Weekly reflection's tab, reads the journal, chats or both, and keeps the **Last 7 days / Last 30 days** choice.
- **Just listen stops asking a question every time.** Questions alternate with a simple invitation to keep going.
- **Chat stops over-using notes.** Haven only mentions "About me" notes or earlier events when the message is about them.

### Why

- Two cloud features both looked back over recent days, with different budgets, formats and safety behaviour. Only Journal insights showed the "left out" message, used coping cards and had the low-mood note. One feature is simpler to use and to explain.
- In real Chrome, Just listen ended every reply with a question, which doesn't match its name.
- A reply to "just feeling depressed" brought up finals and a breakup that the person hadn't mentioned. They came from the About me notes and the summary.

### Insights (cloud, asks you first)

**Place**
- The tab replaces Weekly reflection, so the nav reads **Journal, Chat, About me, Insights, Write a message, Settings**.
- The page lives at `/insights`. `/reflection` redirects there through `redirects()` in `frontend/next.config.ts`, which the Next 16 docs give as the way to do it.
- The insights section leaves the Journal page, which keeps a small link: "See patterns in your notes → Insights".

**Choices** (saved on this device, wiped by Delete everything)
- **Range:** Last 7 days (default) or Last 30 days.
- **What to include:** **Journal notes** and **Chats** checkboxes, both on by default, and at least one must stay on.

**Gathering** (one pure function, replacing `buildWeek` and `buildJournalText`)
- The budget is **900 words** in total.
- With journal only, the journal gets all of it. With both, the journal gets 60% and chats get the rest.
- Journal entries are cut to 80 words each, newest first, with at least one always kept.
- The chat part works like this:
  - Structured summaries in the range come first, because they are compact.
  - Then the person's own messages that aren't summarized yet, at most 5 per day and 40 words each.
  - Whole days are added, newest day first.
- Everything is grouped by day, oldest day first. Each day holds its journal lines (`Journal (mood 4 of 10): …`), then its chat lines.
- One time window is used for both sources: calendar days, from today back 6 or 29 days.
- **Crisis:** crisis-flagged journal entries are left out, and the status line says "N entries were left out and are never sent to any AI". Chats need no filter, because crisis messages are never saved.
- **Status line:** what will be sent, and what didn't fit. For example: "Ready: 12 journal entries and chats from 9 days in the last 30 days (the newest 12 of 20 entries)."

**Instruction** (fixed text, never contains the person's words)
- The first sentence says what was sent: "from their journal", "from their chats" or "from their chats and journal".
- The reply is warm prose, no headings or lists, under about 250 words. It covers:
  1. which days seemed hardest and which lighter
  2. recurring themes
  3. patterns between the ratings and what was written, and what seemed to help, using their own words
  4. two or three small, gentle suggestions
  5. talking to someone they trust or a counselor, only if it would truly help
- It keeps the existing safety lines:
  - never diagnose or label a pattern as a condition, and no medical advice
  - the 1 to 10 rating is their own number, not a measurement
  - no scolding, goals, streaks or missed days
- **Coping cards:** up to 2, retrieved in plain code from the unmasked gathered text, with only the generic card text added to the instruction (as Journal insights does today).

**Shield and result**
- It uses the same `runShielded` preview: nothing is sent until **Send to cloud**.
- The result is shown with **Copy** and is not saved. The footnote says what it was made from, and that it's a reflection, not advice or a diagnosis, and can be wrong.
- **The low-mood note stays plain code:** it appears when the journal ratings in the range average 3 or lower over at least 2 entries, with the **Find a support line** button. With Journal unchecked there are no ratings, so there's no note.

**Removed**
- `app/reflection/`, `lib/reflection.ts` and `app/journal/Insights.tsx` are replaced by `app/insights/` and one `lib/insights.ts`.
- The unused `gatherJournal` goes too.
- The shared day helpers (`localDayKey`, `shiftDay`, `formatDay`, `isSendable`) stay in `lib/journal.ts`.

**Wording updated everywhere "weekly reflection" appears**
- the Settings privacy page (one bullet for Insights in place of two)
- the welcome screen
- the journal crisis prompt ("including Insights")
- the `lib/sampling.ts` comment
- the README (feature table, privacy model, tests)
- `docs/remote-config.md` (which already left out insights)
- `docs/hackathon-checklist.md`

### Just listen: a question every other reply

- Plain code decides, using the existing Listen streak:
  - The first Listen reply after a start or a Help reply asks one question.
  - The next one is told "Don't ask a question this time. End by gently inviting them to say more if they want."
  - Then it alternates.
- The one-time "ideas or just get it out?" offer counts as a question turn.
- The reminder line and the Listen example change to match the turn: the no-question turn gets an example that ends with an invitation, and a reminder that says "no question".
- The sentence cap already keeps the opening and, when there is one, the closing question. A no-question reply is just capped at 4.
- Help mode is unchanged.

### Notes rule

- One line is added to the shared chat instruction: "Only mention their notes or earlier events if their message is about them."
- The "If something from earlier is relevant, bring it up" line stays, so memory still works when it fits.
- This is a small-model instruction, so it should help but may not always hold.

### Testing

- **Gathering:**
  - journal only, chats only, and both
  - the 60/40 split, and the whole budget going to the journal when Chats is off
  - summaries come before messages
  - 30 days fit within 900 words
  - same-day grouping, oldest day first
  - crisis entries are excluded and counted, and their text never appears
  - nothing to send gives null
  - the status counts are right
- **Instruction:** the first sentence matches the chosen sources, it contains none of the person's words, it keeps the safety lines, and cards are added only when retrieval finds them.
- **Low-mood note:** the same thresholds as today, and no note when Journal is off.
- **Redirect:** `/reflection` goes to `/insights` (checked with the built app).
- **Just listen alternation:**
  - question, then invitation, then question
  - the offer counts as a question turn
  - Help resets the alternation
  - the reminder and example match the turn
- **Notes rule:** present in both modes' instruction.
- Existing journal tests are kept or moved, and `reflection.test.ts` and the insights parts of `journal.test.ts` become `insights.test.ts`.

### Phases (stop after each for review)

1. **Insights logic (half a day).** `lib/insights.ts` (gathering, instruction, cards), the saved choices, and tests.
2. **Insights page and nav (half a day).**
   - The `/insights` page with range, checkboxes, status, shield call, low-mood note, result and Copy.
   - The nav change, the `/reflection` redirect, and the Journal page link.
   - Remove the old files.
   - Update the wording everywhere.
3. **Just listen and the notes rule (a few hours).** The alternation, the matching example and reminder, the notes line, and tests.
4. **Docs.** README, checklist, `remote-config.md`, and the status at the top of this addendum.

About a day and a half in total, before the Nov 25 freeze.

## Addendum: choose what Insights sends (v3.3)

Status: **all three phases implemented** (281 tests pass). The Insights page was also driven in a real headless Chrome with seeded notes and chats (24 checks: lists, counts, Select all/none, day checkboxes, the Read popup with Esc and focus return, the locked crisis note, range and source changes). Agreed on 2026-11-16 (Q1 to Q13 of that session, the recommended answer each time). Still to do by a person: send an Insights request to the real cloud model with a hand-picked selection.

As built, three details differ from the draft below:
- The old limit of 5 chat messages per day is gone. The word budget decides how many fit, so every ticked message can be sent if there is room.
- When the budget is full, the newest ticked items are kept and the rest are marked "won't fit" (not whole days at a time).
- The Read buttons have ids, so focus returns to the right button even in browsers that don't focus a button when it is clicked.

**v3.3 redesign (same day).** The first version put a separate **Read** button on every row, which looked heavy, and the notes didn't look like the sticky notes in the Journal tab. After seeing it with real data it was changed:
- **No Read buttons.** Each row is a note card. Clicking it opens the popup (Tab to it and press Enter also works). The checkbox beside it only ticks, so the two never get mixed up.
- **Notes look like notes.** Ticked journal notes keep their paper colour with a solid green border and a mood pill ("3/10"). Chat messages are plain cards with a "You" pill, and a summary leads its day with a "Summary of earlier chats" pill. Unticked notes turn plain with a dashed border, and their text stays at full contrast.
- **Two-line previews** (about 20 words) so many notes can be judged without opening them.
- **Quieter day headings:** a small muted date with a small checkbox.
- **A clearer popup:** a visible edge, a deeper shadow and larger text.
- Checked in a clean headless Chrome in light, dark and phone width.

### Summary

On the Insights page, the person can see every journal note and chat item in the chosen range, and untick the ones they don't want sent. Each row shows the first few words. **Read** opens a small popup with the full text. The shield preview afterwards is unchanged, so it's still the last check before anything leaves the device.

### Why

The checkboxes for Journal notes and Chats are all-or-nothing. Someone might be happy to share most of a week but not one note or one message. Choosing item by item puts that control where the person can see it.

### What the person sees

**Page order**
1. range (Last 7 days or Last 30 days)
2. Journal notes and Chats checkboxes
3. one box per source that is on
4. the status line, with the word count
5. **Get insights**
6. the shield preview (unchanged)

**Each box**
- Header, for example: "Journal notes · 12 of 14 selected", with **Select all** and **Select none**.
- A scrollable list with its own max height, so the page stays short even for 30 days.
- Items grouped by day, newest day first. Each day header has its own checkbox to tick or clear that whole day.

**Each row**
- A **checkbox**, ticked when the page opens.
- For journal notes, the paper colour and the mood ("4/10").
- The first ~12 words.
- A **Read** button. The checkbox and Read are separate controls, so reading never changes what's ticked.

**What the chat items are**
- Each of the person's **own messages** that hasn't been summarized yet.
- **Summary items** for older chats ("Summary of earlier chats").
- Haven's replies are never listed, because they're never sent.

**Crisis-flagged journal notes**
- They're shown greyed out, locked unticked, and labelled "Kept private: never sent to any AI".
- They have no text preview and no Read button.

**The popup**
- It reuses `components/Modal` (focus kept inside, Esc closes, focus returns to the Read button).
- It shows:
  - the day, and the mood for notes
  - the full text
  - an **Include in Insights** toggle
  - **Close**
- When the item is longer than what's sent, a line says so: "Only the first 80 words are sent" (40 for a chat message).

**Ticks reset** to all ticked whenever the page opens or the range or sources change. Per-item choices are never saved.

### Budget and "won't fit"

- The 900-word budget and its rules stay as they are:
  - Notes get up to 60% when both sources have ticked items, and chats get whatever is left.
  - Within chats, summaries go first, then messages, newest day first.
  - Each item is cut to its usual length.
- A live line reads "About 640 of 900 words selected".
- If too much is ticked, it adds "The oldest selected items won't fit and will be left out", and those rows show **won't fit**. Sending is never blocked.
- The **low-mood note** still uses every rating in the range, including unticked notes. It is computed on the device and nothing about it is sent, so leaving a note out of the cloud request doesn't hide that nudge.

### Technical design

- **`lib/insights.ts`**
  - Split gathering into two steps:
    - `listInsightItems(input)` returns every candidate with a stable id, kind (journal, summary or message), day, preview, full text and sent text. Crisis notes are included as locked.
    - `buildInsights(input, selectedIds)` builds the text from the ticked items only, with the existing budget rules. It also returns which ticked ids were left out as "won't fit", and the word count.
  - `averageMood` and `journalInRange` keep using all sendable notes in range.
- **`app/insights/`**
  - An `ItemList` component (box, day groups, rows, select all or none).
  - An `ItemDialog` built on `Modal`.
  - The page keeps the selected ids in state, and resets them when the range or sources change.
- **No new storage.** Nothing about the selection is saved.

### Testing

- `listInsightItems`:
  - lists notes, summaries and the person's own unsummarized messages only, never Haven's
  - crisis notes are locked and carry no text
  - ids are stable
- `buildInsights` with a selection:
  - unticked items never appear in the text
  - nothing ticked means empty text
  - the 60/40 split and summaries-first still hold
  - over budget, the oldest ticked items are reported as "won't fit" and are absent from the text
  - the word count matches the text
- The low-mood note ignores the selection.
- Existing Insights tests still pass with everything ticked (the same output as today).

### Phases (stop after each for review)

1. **Logic (half a day).** `listInsightItems`, selection-aware `buildInsights`, and the tests.
2. **UI (half a day to a day).**
   - The two boxes, rows, day checkboxes and select all or none.
   - The Read popup.
   - The live word count and the "won't fit" marks.
   - Keyboard and phone-width checks.
3. **Docs.** README, the privacy page line on Insights, and the status at the top of this addendum.

About a day and a half in total, before the Nov 25 freeze.

## Addendum: a smaller text size, and calmer chat bubbles (v3.4)

Status: **all four phases implemented** (292 tests pass). Checked in a clean headless Chrome at Smaller, Normal and Larger on Chat, Journal and Insights, in light and dark mode and at phone width. Agreed on 2026-11-16 (Q1 to Q7 of that session, the recommended answer each time).

As built, one detail differs from the draft below:
- The 44px minimum height is applied to the standard buttons and the choice buttons (range, sources, colour mode, text size), which were the ones that fell under 44px only at Smaller. The height floors are in `px`, so they don't change Normal or Larger at all. Controls that were already under 44px at Normal (the top navigation links, the small Select all / Select none buttons, the day checkboxes) are unchanged. They are the same size at Smaller as they were before.

### Summary

- **Settings > Appearance gets a third text size.** The control becomes **Smaller / Normal / Larger**, and Normal stays the default.
- **Chat bubbles get a width limit on wide screens**, so lines are shorter and replies look less dense.

### Why

On a wide screen the chat looked cluttered: long Nano replies ran about 85 characters per line, and the Journal's notes looked large. Some people simply prefer smaller text.

Haven's design rule is readable text for someone who is tired and finds it hard to concentrate. Smaller text works against that for some people, so Normal stays the default and the new size is a choice in Settings, never the starting point.

### Text sizes

| Size | Root font size | Body text | Saved as |
| --- | --- | --- | --- |
| Smaller | 88% | about 15px | `small` |
| Normal (default) | 100% | 17px | nothing saved |
| Larger | 112.5% | about 19px | `large` |

- 15px is the floor. Going lower would hurt legibility quickly.
- **Everything is sized in `rem`**, so a smaller root shrinks padding and gaps as well as the letters. That is deliberate: bubbles, notes and margins all get proportionally smaller, which is what makes the chat and journal feel less crowded.
- **Applies to every page** right away when picked. It is saved on this device like Dark mode and Larger text, restored from a backup, and cleared by Delete everything.
- **No flash on load.** The small script in `app/layout.tsx` that applies the saved theme and size before the first paint learns the new `small` value.
- **Settings only.** There is no A- / A+ button in the chat header.

### Technical design

- `lib/appearance.ts`: `TextSize` becomes `"small" | "normal" | "large"`. `getTextSize` and `setTextSize` handle all three, and anything unrecognised reads as Normal. `applyAppearance` sets `data-text="small"` or `"large"`, or removes the attribute for Normal.
- `app/globals.css`: add `html[data-text="small"] { font-size: 88%; }` next to the existing Larger rule.
- `app/layout.tsx`: the inline init script sets `data-text` for `small` as well as `large`.
- `app/settings/AppearanceSettings.tsx`: a three-way control, Smaller / Normal / Larger, with the same look and keyboard behaviour as today.
- **Chat bubbles** (`app/(chat)/ChatView.tsx`): on wide screens a bubble's text width is capped at about 36rem (about 65 characters per line at Normal). On phones it keeps its current 85% of the width.
- **Tap targets:** controls are `rem`-sized, so they shrink with the text. Any button or checkbox that falls under 44px high at Smaller gets a `min-height` in `px` so it stays easy to tap.

### Testing

- Unit tests (`appearance`):
  - the default is Normal with nothing stored
  - small, normal and large round-trip through storage
  - a bad stored value reads as Normal
  - `applyAppearance` sets and clears `data-text` correctly
  - Normal is stored as nothing
- A backup that contains the setting restores it, and Delete everything clears it.
- In a clean headless Chrome, with seeded chats, notes and Insights data, at Smaller, Normal and Larger:
  - Chat, Journal and Insights, in light and dark mode and at phone width
  - no text cut off and no sideways scrolling
  - every control at least 44px high
  - bubble width capped on a wide window and not on a phone
  - the size applied from the first paint (no flash)

### Phases (stop after each for review)

1. **The size option (a few hours).** `appearance.ts`, the CSS rule, the layout script, the three-way control and the unit tests.
2. **Bubble width and tap targets (a few hours).** The bubble cap, any `min-height` fixes found in phase 3, and tests where they apply.
3. **Check in Chrome (a few hours).** The matrix above, with screenshots and a short report of what was found and fixed.
4. **Docs.** README (features table and tests), the checklist, and the status at the top of this addendum.

About a day in total, before the Nov 25 freeze.

## Addendum: a wide Insights page (v3.5)

Status: **all four phases implemented** (296 tests pass). Driven in a clean headless Chrome: 69 layout checks across 5 window widths and 3 text sizes, 29 behaviour checks, and the full Get insights flow with the cloud call replaced by a stub (exactly one request was made, and it never left the browser). Agreed on 2026-11-17 (Q1 to Q8 of that session, the recommended answer each time). Still to do by a person: run Insights against the real cloud model. `next build` was not run, to avoid disturbing the running dev server; typecheck, lint and tests pass.

As built, these details differ from the draft below:
- The two lists sit side by side from about 1280px (the `xl` breakpoint), not 1024px. At 1024 to 1279px they stack on the left with the panel on the right, because side by side they were too narrow to read.
- The page's maximum width is 1600px (in `px`, not `rem`), so the Smaller text size doesn't leave more of a wide screen empty.
- The phone bar is **sticky at the end of the page**, not fixed, so it rests above the disclaimer instead of covering it. (A fixed bar hid the disclaimer; the check caught it.)
- Only the result scrolls inside the panel. The status, meter and button stay put above it, so **Get insights** is always reachable, and on a wide screen the page doesn't scroll when a result arrives. On a phone the page scrolls to the result.
- List headers show the title with "14 of 14 selected" beneath it, so both headers have the same height.
- Journal previews hold up to 30 words and 3 lines.

### Summary

The Insights page used a single narrow column (about 42rem), so the lists, the status, the button and the result were all stacked, with most of the screen empty. v3.5 gives it the whole page: the choices on top, the two lists side by side, and a panel on the right that holds the status, the **Get insights** button and the result. Only Insights changes. The other pages keep their widths.

### Why

- Getting to **Get insights** meant scrolling past the intro, the range, the sources, a Journal box, a Chats box and the status.
- The result appeared far below the choices, so you couldn't read it and adjust ticks together.
- On a wide screen, a narrow column leaves most of the page unused.

### Layout

**Wide screens (about 1024px and up)**

```
Insights  [Cloud · asks you first]   one short line of intro
[ How far back: 7 | 30 ]  [ Look at: Journal notes | Chats ]   <- one compact bar

+ Journal notes ------+ + Chats ------------+ + Your insights ------+
| tall scrolling list | | tall scrolling list| | status, word meter   |
|                     | |                    | | [ Get insights ]     |
|                     | |                    | | the result           |
+---------------------+ +--------------------+ +----------------------+
```

- The page is up to about 90rem wide and centred.
- The right panel is **sticky**, so it stays in view while you scroll the lists, and **Get insights** is always reachable.
- The result appears in the panel, next to your selection. You can read it and still change ticks.
- The panel scrolls inside itself if the result is taller than the window.

**Medium screens (about 768 to 1024px):** the two lists stack on the left, and the panel stays on the right.

**Phones:** everything stacks. A **bottom bar** holds the word count and **Get insights**, so the button is always in reach. The result appears below the lists.

### The pieces

- **Compact choice bar.** How far back and what to look at, as two small segmented controls in one row. The same radio and checkbox behaviour as today, with at least one source always on.
- **Intro:** one line, "A gentle look back at your notes and chats. Nothing leaves this device until you press Send." The longer explanation of the cloud and the shield stays where the shield preview is shown.
- **Tall lists.** Each list fills most of the window's height and scrolls inside itself, instead of stopping at a small fixed height. Journal cards show up to 3 lines of preview when there's room.
- **Word meter.** A small bar, "640 of 900 words". Under it, plain text for what won't fit and how many crisis-flagged notes are left out. The numbers stay as text, so it never relies on colour alone, and the bar has an accessible name and value.
- **One source on.** The list that is on widens to fill the space of the other. Journal notes show in two columns when there's room.
- **Unchanged:**
  - the ticking, the Read popup and its contents
  - the locked crisis notes
  - the budget rules
  - the shield preview
  - the low-mood note
  - the result with **Copy** and its footnote

### Technical design

- **`app/insights/page.tsx`** is restructured into a header, a choice bar, a picker area (a CSS grid of one to three columns depending on width and sources), and a panel.
- **New small components in `app/insights/`:** `ChoiceBar`, `ResultPanel` (status, meter, button, result) and `WordMeter`. `ItemList` and `ItemDialog` stay as they are, apart from list height and preview lines.
- **Sticky:** the panel uses `position: sticky` inside the page's own scroll area, with a `max-height` and its own scrolling, so a long result never pushes the button away.
- **Phone bottom bar:** a fixed bar on small screens with the word count and button, with space left at the bottom of the page so nothing hides behind it.
- **Sizes:** all in `rem`, so Smaller, Normal and Larger text all scale the layout.
- **Dark mode:** colours come from the existing tokens, so nothing new is needed.

### Testing

- Pure logic stays as is. The existing `insights.test.ts` still passes.
- A small test for the word meter's numbers: the fill, "won't fit" and left-out text, and the empty state.
- In a clean headless Chrome with seeded notes and chats, at Smaller, Normal and Larger text:
  - at about 1400px wide and 2000px wide, 1024px, 768px and a phone width
  - three columns on wide screens, two on medium, and one stacked on a phone
  - the panel stays in view while a list scrolls
  - the result opens in the panel and stays readable
  - the bottom bar on a phone, with nothing hidden behind it
  - one source on, both on, and nothing ticked
  - no sideways scrolling and no cut-off text
  - light and dark mode
- I will look at the screenshots myself and describe what I see before calling it done.

### Phases (stop after each for review)

1. **Layout (half a day).** The grid, the choice bar, the sticky panel and the tall lists.
2. **Panel and meter (half a day).** The word meter, the result in the panel, the phone bottom bar, and the one-source widening.
3. **Check in Chrome (a few hours).** The matrix above, with screenshots and a short report of what was found and fixed.
4. **Docs.** README and the status at the top of this addendum.

About a day and a half in total, before the Nov 25 freeze.

## Addendum: calmer note cards and a better popup (v3.6)

Status: **implemented, then simplified the same day.** The cards were redesigned as planned (a calmer ticked and unticked look). The popup was first built with an included / left-out line, Previous / Next, a close "×" and a wider panel, and then **cut back to a plain card on request**: "I just want a normal card". 297 tests pass. Driven in a clean headless Chrome on desktop and phone, in light and dark mode and at Smaller and Larger text. Agreed on 2026-11-17 (Q1 to Q6 of that session, the recommended answer each time).

**What the popup is now** (everything below about the included state, Previous / Next, the "×" and the wider panel was removed and is not built):
- The date as the heading, the mood (or "Summary of earlier chats" / "Your message") under it, the full text, and one **Close** button. No checkbox.
- A note longer than what is sent says "Only the first 80 words are sent" (40 for a chat message). That is the one extra line, because it tells you what actually goes to the cloud.
- A very long note scrolls inside the card, so the card always fits the window.
- Esc, the Close button and clicking outside all close it, and focus returns to the card that opened it.
- The stepping code and the two options added to `components/Modal.tsx` for it were removed again, so `Modal` is back to what it was.

**What stays from this addendum:** the lighter cards in the lists (ticked: the note's paper colour, a thin edge, a soft shadow and a strip down the left; unticked: flat and dashed; a visible ring on hover and keyboard focus).

The sections below describe the original plan.

### Summary

- The **Include in Insights** checkbox leaves the popup. The popup is for reading. Ticking stays on the checkbox beside each note.
- The note cards in the lists get a lighter look: every ticked card no longer carries a heavy green border.
- The popup looks like a real note, and gets **Previous / Next** so you can read through your notes without closing it each time.

The page layout from v3.5 is unchanged.

### Why

- With every card ticked, each one had a 2px green border, so the lists looked busy and the content was hard to scan.
- The popup was a small flat box. It had a checkbox that repeated the one on the row.
- Deciding what to send from 20 notes meant opening and closing the popup 20 times.

### Cards in the lists

| State | Look |
| --- | --- |
| Ticked | The note's paper colour, a thin neutral border and a soft shadow, plus a coloured strip down the left edge in a darker shade of the paper |
| Unticked | Plain background and a dashed neutral border, with no strip and no shadow. The text stays at full contrast |
| Hover or keyboard focus | A visible accent ring, so it is clear what you are about to open |
| Won't fit | The same as ticked, with the "won't fit" pill, as now |
| Locked (crisis) | Unchanged: a dashed card saying it is kept private, with no text |

- The checkbox beside each card, the pills ("3/10", "You", "Summary of earlier chats"), the two-to-three line preview and the day groups stay as they are.
- Chat cards use the neutral background with the same strip in a neutral tone.
- Colours come from the existing tokens, so dark mode follows. The strip is decorative, so it never carries meaning on its own: ticked is also shown by the checkbox itself.

### The popup

- **No checkbox.** It only shows the note.
- **Read-only state line** under the text: "Included in Insights" or "Left out", so you can see the state of the note you are reading. You change it from the row.
- **Looks like a note:**
  - a bigger date as the heading
  - the mood as a pill ("Mood 3 of 10"), the same pill style as in the list
  - larger, relaxed text
  - a **close "×"** in the top corner, plus the **Close** button at the bottom
  - the note's paper colour with a clear edge and shadow (as set in v3.3)
- **Wider:** about 40rem instead of 36rem. Long text scrolls inside the popup, so the popup never grows taller than the window.
- **Previous / Next:**
  - Two buttons, and the left and right arrow keys, move to the neighbouring note in the same order as the list the note came from (Journal notes or Chats).
  - A small "3 of 14" shows where you are. The buttons are disabled at either end.
  - The popup stays open and focus stays inside it. When it closes, focus returns to the card you last read, not the one you first opened.
  - Locked (crisis) notes are skipped, because their text is never shown.
- Esc still closes the popup, and clicking outside still closes it.

### Technical design

- **`app/insights/ItemList.tsx`:** new card styles as above, and the list passes its ordered, readable items to the page so the popup can step through them.
- **`app/insights/ItemDialog.tsx`:** removes the checkbox and the `included` / `onToggle` props, adds a read-only included flag, Previous / Next, the position, the "×" and the wider panel. It gets the neighbouring items and an `onMove` callback.
- **`app/insights/page.tsx`:** keeps which item is open as an id plus the list it belongs to, derives the neighbours from the current items, and no longer passes a toggle to the popup.
- **`components/Modal.tsx`** is reused as is. The arrow keys are handled inside the popup, so the shared dialog stays unchanged.
- No changes to the data, the budget rules, the shield or anything saved.

### Testing

- Unit tests for the stepping logic: neighbours in list order, none past either end, locked notes skipped, and the position text. It is kept as a small pure function so it can be tested without a browser.
- In a clean headless Chrome with seeded notes and chats, in light and dark mode, at Smaller, Normal and Larger text and at phone width:
  - no checkbox in the popup, and the state line matches what the row says (and updates after changing the row and reopening)
  - Previous / Next and the arrow keys step through the right notes, stop at the ends, skip locked notes, and never change what is ticked
  - Esc and clicking outside close it, and focus returns to the right card
  - ticked and unticked cards look different without relying on colour alone, and focus and hover are visible
  - a long note scrolls inside the popup and the popup fits the window
  - the earlier behaviour checks (ticking, select all and none, day checkboxes, the meter) still pass
- I will look at the screenshots myself and describe what I see before calling it done.

### Phases (stop after each for review)

1. **Popup (half a day).** Remove the checkbox, add the state line, the wider panel, the "×", Previous / Next with arrow keys, the stepping logic and its tests.
2. **Cards (half a day).** The lighter card look and the focus and hover states.
3. **Check in Chrome (a few hours).** The checks above, with screenshots and a short report.
4. **Docs.** README and the status at the top of this addendum.

About a day in total, before the Nov 25 freeze.

## Addendum: a calmer Insights page (v3.7)

Status: **implemented** on 2026-11-17 (Q1 to Q8 of that session, the recommended answer each time). Built straight away as visual changes only, then checked in a clean headless Chrome on desktop and phone (40 checks) and in dark mode. 297 tests pass.

### Why

The person this app is for may be going through a hard time. In real use the page felt overstimulating: a solid dark checkbox on every note and every day, brightly coloured journal cards, and the title and choices hugging the left with empty space on the right.

### What changed

- **No checkboxes.** Every note starts included. Each card has a small, muted **Leave out** link in its corner. A note left out turns dashed, says "Left out", and its link becomes **Include**. The day checkboxes are gone, and dates are small quiet headings.
- **Quiet "all" controls.** Select all / Select none became two small text links in each list's header: **Include all · Leave all out**. The count reads "3 of 4 included".
- **Plain cards.** Journal and chat cards look the same: a plain neutral card with a thin light border. No paper colours, no coloured strip, no shadow. (The Journal page's own sticky notes keep their colours; this is only Insights.)
- **Plain labels.** The boxed labels became muted text: "Mood 3/10" on journal notes and "Summary" on chat summaries. Your own chat messages have no label.
- **Centred top.** The title, the one-line intro and the two choice groups are centred above the lists. `PageTitle` gained a `centered` option so the title and its tag stay centred even when they wrap on a phone.
- **Plain popup.** The card that opens on click uses the same neutral background as the list cards.
- **Wording.** "Ticked" became "included" everywhere a person reads it, including the word meter's note ("Leave some out to make room") and the privacy page.
- Nothing changed in what is sent, the budget, the shield or the low-mood note.

### Follow-up (same day): a check circle instead of "Leave out"

"Leave out" and "Include" were misleading (they could read as being about the note itself, not about what is sent), so they were replaced:

- Each card has a soft **check circle** in its corner. Selected: a pale circle with a thin check mark. Not selected: an empty ring, and the card turns dashed and muted. The check mark, not only the colour, shows the state.
- The circle is drawn small (24px) with a 44px tap area. It is a button with `role="checkbox"` and `aria-checked`, so a screen reader announces it as a checkbox, and Space toggles it from the keyboard. Clicking it never opens the card, and clicking the card never changes it.
- There is no "Left out" label on cards any more. The header links read **Select all · Select none**, and the count reads "3 of 4 selected".
- Other wording follows: the word meter's note says "Select fewer to make room", and the privacy page says you can "choose which ones to send".
- One sentence keeps the words "left out" on purpose: "1 journal entry was left out and is never sent to any AI". That is about a crisis-flagged note, which is never sent whatever you choose.

## Addendum: edit a note right where you read it (v3.9)

Status: **implemented** on 2026-11-17 (Q1 to Q5 of that session, the recommended answer each time). The Journal board was not touched. Checked in a clean headless Chrome on desktop and phone (60 checks) with screenshots.

### Why

Opening a note showed its text, and an **Edit** button then swapped the card for the same long form used to create a note. That was clunky, and the text had no border to show where you type.

### What changed

- **One card for new and existing notes.** Opening a note shows its date, its mood as quiet text, and its words in a clearly bordered box (2px) that you click into and edit. There is no Edit button and no separate edit form. A new note is the same card with an empty box.
- **Save appears only after a change.** Nothing saves while you type. The crisis check still runs when you press Save, so crisis words show the support screen first and are never stored until you choose "Save privately". (Saving on every keystroke would have stored text before that check.)
- **Closing with changes still asks** "Discard your changes?" (Esc and clicking outside do too, and clicking outside does not close the card while there are changes).
- **Mood and colour are tucked away** behind a quiet "Change mood or colour" link on an existing note. A new note starts with them open, because a mood is needed. Changing either makes Save appear, and the paper recolours live.
- **Delete is a small muted "Delete note" link** at the corner of the card (red only on hover). It still asks "Delete this note?" first.
- **A note kept privately** still says "Kept private. This note is never sent to any AI."
- **The board is unchanged**: the coloured sticky notes, the layout, and clicking an empty spot to add a note.
- `NoteDialog` lost its "edit" mode; `tools/shots/shoot.mjs` was updated for the new open, edit and delete steps. (Its later steps for Insights and the weekly reflection were already out of date from earlier changes and were left alone.)

## Addendum: Small steps, a gentle plan for the coming week (v3.10)

Status: **all phases implemented** (334 tests pass). Driven in a clean headless Chrome on desktop and phone with the cloud call replaced by a stub (60 checks: the tab's place, the choices, the preview before anything is sent, exactly one request, the saved plan surviving a reload, a new plan replacing it, a reply that isn't steps shown as plain text, delete with its confirm, and light and dark mode). Agreed on 2026-11-18 (Q1 to Q9 of that session, the recommended answer each time). Still to do by a person: make a real plan with the real cloud model and read how it sounds.

As built, these details differ from the draft below:
- The header row was widened from `max-w-5xl` to `max-w-6xl`, because seven tabs plus the longest status badge no longer fit on one row. It still fits on one row at Smaller and Normal text at 1100px and wider, and wraps the badge to a second row only for Larger text around 1100px.
- `ChoiceBar` (shared with Insights) now takes an optional third source, About me, shown only when a page asks for it.
- `buildInsights` gained an optional word budget, so About me notes (up to 100 words) come out of the same 900.
- An About me note that reads as crisis language is left out of the text, even though notes are checked when typed, because a restored backup could contain one.
- The pure plan logic lives in `lib/plan.ts` (no browser or model), the gathering and instruction in `lib/smallSteps.ts`.

### Summary

A new cloud feature, **Small steps**, in its own tab just left of Settings: **Journal, Chat, About me, Insights, Write a message, Small steps, Settings**. Insights looks back. Small steps looks ahead: three small, concrete steps for the next week, built from what the person has shared, saved on this device so they can reread it. It is never a treatment plan, and it never tracks or nags.

### The page (calm, centred, one column)

```
            Small steps   [Cloud · asks you first]
   A few gentle ideas for the coming week, built from what you've shared.

   How far back:  [Last 7 days] [Last 30 days]
   Look at:       [Journal notes] [Chats] [About me]

                    [ Make my plan ]

   Your plan · made Nov 18 from your last 7 days
   1. …
   2. …
   3. …
   If things feel heavier: talk to someone you trust or a counselor.  [Find a support line]
                                              Make a new plan · Delete plan
```

- **Sources:** Journal notes, Chats and About me notes. All three are on by default, and at least one must stay on. There is no per-note picker; the shield preview still lets you hide any word before sending.
- **Range:** Last 7 days (default) or Last 30 days. The choices are remembered on this device, like Insights.
- **If a plan exists**, it shows straight away. The button reads **Make a new plan**, which replaces the old one after the preview.
- **No tracking:** no checkboxes on steps, no reminders, no streaks, no goals.

### What is sent

- The same gathering as Insights (`buildInsights`, everything in range, crisis-flagged notes never included) within the same 900-word budget, with the person's About me notes first (up to 100 words).
- It goes through the same shield preview: names and places are hidden first, and nothing leaves the device until **Send to cloud**.

### The instruction (fixed text, never contains the person's words)

- Write exactly three short steps for the next week, numbered 1 to 3, each one sentence or two, each small and concrete, and where possible built on something the person said helped.
- Everyday things only: rest, movement, food and water, people, small routines, time outside, things they enjoy.
- **Never** diagnose, never give medical advice, never mention medication, therapy techniques or treatment, never set goals or targets, never mention streaks or missed days.
- End with one gentle line about talking to someone they trust or a counselor if things feel heavier.
- Up to 2 matching coping cards are added, in plain code, the same way Insights does.

### The result

- Plain code turns the reply into a numbered list of three steps plus the closing line. If the reply doesn't come back in that shape, it is shown as plain text instead.
- The **Find a support line** button sits under the closing line (it opens the existing crisis-lines screen).
- The plain-code **low-mood note** from Insights shows above the plan when the person's own ratings in the range have been low.
- Footnote: "This is a few ideas from an AI, not a treatment plan, and it can be wrong."

### Saved on this device

- The latest plan only: its text, the steps, when it was made, the range and sources, and the low-mood flag. It is stored in local storage as `haven.plan`.
- **Delete plan** removes it (after a "Delete your plan?" confirm). Making a new plan replaces it.
- It is included in **Download my data** and restored by **Restore from file**, and wiped by **Delete everything**. Backup settings values are currently limited to 1,000 characters; that limit is raised (to 6,000) so a plan always fits. Older backups still load.
- The privacy page gets one line for Small steps in the "can go to the cloud, only when you choose" list.

### Technical design

- `lib/smallSteps.ts`: gathering (reusing `buildInsights` plus the About me notes), the instruction, parsing the reply into steps, and the saved-plan read and write helpers.
- `app/steps/page.tsx` (route `/steps`) and a nav entry in `components/Shell.tsx`.
- Reuses `ChoiceBar` (with a third source), the shield preview, `WordMeter` is not needed (no picker), and the low-mood helper.
- `@haven/backend` backup validation: the settings value limit goes from 1,000 to 6,000 characters.

### Testing

- Unit tests: gathering with each source on and off (About me first, within budget, crisis notes never included), the instruction (never contains the person's words, has the safety lines, says exactly three steps), parsing (three numbered steps and the closing line, odd shapes fall back to plain text), the saved plan (round trip, delete, bad stored data ignored), and a backup with a long plan restoring correctly.
- In a clean headless Chrome: the tab's place in the nav, the page layout at desktop and phone width, Make my plan with the cloud call replaced by a stub (shield preview first, exactly one request, the plan shown and saved), reload shows the saved plan, Make a new plan replaces it, Delete plan asks then removes it, the low-mood note, and light and dark mode. I will look at the screenshots myself.

### Phases

1. **Logic and storage (half a day).** `lib/smallSteps.ts`, the backup limit, and the tests.
2. **Page and nav (half a day).** The page, the saved plan display, delete, the privacy line, and the checks in Chrome.
3. **Docs.** README, checklist and the status at the top of this addendum.

## Addendum: Small steps 2, a researched plan built with you (v3.11)

Status: **all four phases implemented** (397 tests pass). Agreed on 2026-11-18 (Q1 to Q13 of that session, the recommended answer each time). This replaced the one-click flow of v3.10 on the same tab. Still to do by a person: make a real plan with the real cloud model and read how it sounds, and have someone review the plan-ideas library.

As built, these details differ from the draft below:
- **The second request sends a summary, not the notes again.** The first request asks the cloud model for a short summary (no names or places) as well as the questions. The plan request sends that summary plus the answers, so the person's raw notes leave the device once, not twice, and the second preview is short. The summary is written by the model, so the preview shows it and everything is masked again. This changes the agreed wording ("the second preview shows only your answers") to "only the summary and your answers".
- **The library was checked twice.** Seven research passes wrote 53 ideas from pages they opened. Three independent checkers then re-opened every page: only 11 ideas held up as written. The other 42 added detail the page didn't give (mostly "weekly" or "regularly"): 38 were rewritten and 4 were dropped. See `docs/plan-ideas.md` for the ideas, sources and limits. Final library: 49 ideas, 6 to 8 per situation.
- **The library is thinner on publishers than intended.** Mind, the Mental Health Foundation and others blocked the automated fetches. Conflict, loneliness and stress each rest on three publishers.
- **Per-note word limits were raised too**, not only the 900-word total: up to 250 words of a journal note, 150 of a chat summary and 100 of a message are kept for the plan (Insights is unchanged).
- **With no notes at all**, Get started goes straight to a few plain questions with no cloud request, and the plan is then built from the answers alone.
- **The plan records which publishers' guidance the writer was given** ("Written with the help of general guidance from ..."), so the person can see what it rests on.
- **A first reply the app can't read** falls back to three generic questions (plus the two fixed ones); **a plan reply that isn't weeks** is shown as plain text; **a stream that breaks halfway** shows an error, keeps the answers and leaves any saved plan untouched.
- **Old v3.10 plans** (a few steps) are still read and shown.

### Summary

Small steps becomes Haven's second flagship feature. Instead of three quick tips, it builds a **4-week plan of concrete, longer-term activities**, in three stages:

1. **Understand.** Haven sends the person's notes (shield and preview first). The cloud model reads them and writes **a few questions** tailored to what they're going through.
2. **Your answers.** The person answers in simple text boxes. Every question is optional.
3. **The plan.** Haven sends the answers (with the earlier context), and the cloud writes the plan, which appears **as it is being written**.

Plans are grounded in a **researched library of plan ideas** with saved sources, not in live web search.

### Why not live web search

Researched on 2026-11-18 (sources in the session notes):
- A browser-only app can't scrape other websites (browsers block reading them, and Haven has no server).
- Firebase AI Logic's **Grounding with Google Search** is "Not available" on the free tier for the model Haven uses. It needs a billing account (Blaze), it requires showing Google's search suggestions and source links with every grounded result, and Google's terms restrict storing grounded results (saving a plan is only arguably allowed). The terms also forbid using the service for medical advice.
- So: a library researched now, with every source linked, the same way the coping cards were checked. Search can be reconsidered later if the project moves to Blaze.

### Stage 1: understand

- Same choices as now: Last 7 or 30 days, and Journal notes, Chats and About me (at least one on).
- **Word budget raised from 900 to 3,000 words** (About me notes up to 200 of those). The cloud model can take far more, but a cap keeps the preview readable and tells the person roughly how much goes out.
- Crisis-flagged journal notes and About me notes with crisis language are never included (as now).
- The cloud model returns **3 to 5 questions** written for this person's situation, short and kind, never about anything clinical. Plain code always adds two more:
  - "Is there anything you'd rather not do, or not be reminded of?"
  - "How much time could you give this in a normal week?"
- The questions are shown together once they arrive (they are short, so no streaming).

### Stage 2: your answers

- One text box per question, all optional, with **Make my plan** and a **Start over** link.
- **Crisis check on the answers**, in plain code, before anything is sent. Crisis language shows the support screen and nothing is sent.
- The second preview shows **only the answers** (masked), with a line saying the notes already reviewed are sent again. The full request still goes through the shield.

### Stage 3: the plan

- **4 weeks, 2 or 3 activities each.** Each activity has: what it is, why it might help (tied to the answers), a concrete first step, and roughly how often. Long-term and concrete, never "drink a glass of water".
- The instruction tells the model:
  - build on what the person enjoys and said helped, and on the matching library entries
  - **never suggest anything tied to the person, place or situation that's hurting** (for example, nothing a couple used to do together after a breakup), and respect the "rather not" answer
  - fit the time they said they have
  - everyday life only: people, movement, interests, routines, learning, nature, helping others, rest. No medication, no therapy techniques by name, no diagnosis, no goals, targets, streaks or check-offs.
  - end with: if after a couple of weeks things feel the same or heavier, it's worth talking to a counselor or doctor
- **Streams in as it's written**, through the shield. Placeholders like [PERSON_1] are swapped back as soon as they are complete; a half-received placeholder is held back until it finishes.
- When it's done, plain code turns it into weeks and activity cards. If the reply doesn't come back in that shape, it is shown as plain text.
- Under the plan: the gentle closing line and **Find a support line**. The plain-code **low-mood note** shows above it when the person's own ratings have been low. Footnote: "A few ideas from an AI, built on general wellbeing guidance. It isn't a treatment plan, and it can be wrong."
- **Saved on this device** (the latest plan only), with **Make a new plan** and **Delete plan**, in backups, wiped by Delete everything. No tracking, reminders or check-offs. The backup setting limit goes from 6,000 to 20,000 characters so a 4-week plan always fits.

### The researched library of plan ideas

- A small file (`backend/data/planIdeas.json`) like the coping cards: for each situation, a handful of longer-term activity ideas, each with tags for matching, a one-line rationale, and its **source** (name and URL) with the date it was checked. Marked "not clinically reviewed".
- Situations: heartbreak, grief and loss, exam and work stress, loneliness or moving somewhere new, friendship or family conflict, burnout, low motivation.
- Sources: credible public guidance only (for example the NHS, Mind, Samaritans, university counselling services, national health bodies). Every link is opened and its advice compared before it goes in, as was done for the coping cards.
- In plain code, the best-matching entries (by keyword, on the device, from the gathered text and the answers) go into the instruction as grounding. Only the generic library text is sent, never matched personal words.

### Technical design

- `lib/smallSteps.ts`: stage 1 and stage 3 gathering, the two instructions, parsing the questions, parsing the plan into weeks and activities.
- `lib/shield.ts` / `components/ShieldProvider.tsx`: a streaming variant of the shielded send that un-masks progressively, holding back a partial placeholder.
- `backend/src/planIdeas.ts` + `backend/data/planIdeas.json`: the library and its matching, with tests.
- `lib/plan.ts`: the saved plan becomes weeks of activities (older saved plans from v3.10 are still read and shown as plain steps).
- `app/steps/page.tsx`: the three stages.

### Testing

- Unit tests: gathering within 3,000 words; question parsing (3 to 5 plus the two fixed ones, odd replies handled); plan parsing (4 weeks, 2 or 3 activities with their four parts, fallback to plain text); progressive un-masking (placeholders split across chunks, never shown half-done); the library (data checks, every entry sourced, matching per situation, nothing personal sent); the crisis check on answers; the saved plan (round trip, old v3.10 plans still read, fits a backup).
- In a clean headless Chrome with the cloud calls replaced by stubs: the three stages, the two previews (the second showing only the answers), streaming text appearing before it finishes, the plan cards, start over, skip all questions, crisis words in an answer stopping the send, delete, reload, light and dark, phone width. I will look at the screenshots myself.

### Phases (stop after each for review)

1. **Library research (about half a day to a day).** Research and write the plan ideas with sources, plus the matching and its tests.
2. **Logic (half a day).** Gathering, the two instructions, question and plan parsing, saved plan format, streaming un-mask, tests.
3. **Page (about a day).** The three stages, streaming display, previews, crisis check on answers, plan cards, checks in Chrome.
4. **Docs.** README, privacy page, checklist, and the status at the top of this addendum.

## Addendum: a home page, and Chat moves to /chat (v3.12)

Status: **implemented, then changed (see the last note below).** Agreed on 2026-11-18 (Q1 to Q6 of that session, the recommended answer each time). Checked in headless Chrome (12 checks, desktop and phone) and all 397 tests pass. The card wording was confirmed with the user before building.

### What changes

- **Chat moves to `/chat`.** The nav label stays "Chat". Everything about chat itself is unchanged: the "Start chatting" button (which starts the private model download, and has to come from a click), the progress bar, the "browser can't run the private model" help and the cloud-chat option all stay on `/chat`.
- **`/` becomes a home page**, shown every time, including for people who have used Haven before.
- **No new "Home" tab.** The "Haven" logo already links to `/`, so the header stays as it is.
- The full-height chat layout and its footer disclaimer, which `Shell` applies to `/` today, apply to `/chat` instead. The home page uses the normal scrolling layout.

### The home page, top to bottom

1. **A short intro:** "Haven is a quiet place for stress and tough times."
2. **A clear disclaimer box:**
   > **Haven is not a substitute for professional help.** It's a companion for everyday stress, not a doctor, therapist or counsellor. It can't diagnose, treat or give medical advice. If you're in danger or thinking about harming yourself, contact your local emergency number or a crisis line now.

   With a **Find a support line** button that opens the existing support-line screen (`triggerCrisis("browse")`).
3. **Plain feature cards**, one per feature in nav order: Journal, Chat, About me, Insights, Write a message, Small steps, Settings. Each card has the name, one plain sentence, and a small tag: **Private** (stays on this device) or **Asks first** (can use the cloud, only after a preview). The whole card links to the feature. No colours, no icons, the same calm style as Insights and the Journal.
4. **How your privacy works:** the three points from the current chat welcome screen.

### Technical design

- Move `app/(chat)/` (page, ChatView, Welcome) to `app/chat/`.
- New `app/page.tsx` for the home page, with the feature list as a small constant.
- `components/Shell.tsx`: the Chat nav entry becomes `/chat`, and the full-height check becomes `pathname === "/chat"`.
- Update any links or test scripts that assume chat is at `/`.

### Testing

- Unit tests still pass, plus type check and lint.
- In headless Chrome: `/` shows the disclaimer, the 7 cards and their links; Find a support line opens the support lines; `/chat` shows Start chatting and, once ready, the full-height chat; the logo goes home; the Chat tab is marked active on `/chat`; light and dark, phone width. I will look at the screenshots myself.

### Phases

1. **Build (about an hour).** Move chat, the home page, Shell changes, checks in Chrome.
2. **Docs.** README, checklist, and the status at the top of this addendum.

As built, one change after the first version: **the home page is now a full-screen opening page.** The first screen holds only the welcome, the disclaimer and a quiet "See what Haven can do" link. The feature cards and "How your privacy works" sit below it, reached by scrolling or by that link (which scrolls smoothly, or jumps if the person prefers reduced motion). Checked in headless Chrome at desktop and phone width: the first screen is filled, the link is visible without scrolling, and it scrolls to the cards.

**Final version: a one-time agreement page (replaces the home page above).** The user clarified that the page is a one-time gate, not a landing page.
- On a first visit, **every route** shows the agreement page instead of Haven. It has the welcome, the "not a substitute for professional help" box with **Find a support line** (which works before agreeing), the feature list (plain cards, **not links**), "How your privacy works", and at the end a **checkbox** ("I understand that Haven is not a substitute for professional help, and I agree to use it on that basis.") and a **Continue** button that stays disabled until it is ticked. While it shows, the header has only the logo, with no tabs.
- Agreeing saves `haven.agreed` on this device and lets the person in, on the page they asked for (from `/`, Chat). It never shows again, and `/` now just goes to Chat.
- The flag is **not in backups** (restoring on another device asks again) and is wiped by **Delete everything**, so after that the page shows again.
- A returning person never sees a flash of it: nothing is drawn until the saved answer is read.
- Checked in headless Chrome (25 checks): `/`, `/chat`, `/journal` and `/settings` are all gated; cards aren't links; Continue is disabled until ticked and then lands on Chat with the tabs; reload doesn't gate again; the phone view has no sideways scroll.
- **Older Chrome test scripts** start from a fresh profile, so they now need `localStorage.setItem("haven.agreed","1")` first.
- **Follow-up:** the tag on Insights and Small steps now reads **Cloud** (not "Asks first"), and a small prompt, "Scroll down to read everything", sits at the bottom middle until the agreement itself is on screen. Clicking it scrolls there.

## Addendum: Small steps, Private or Cloud (v3.13)

Status: **all three phases implemented** (423 tests pass). Agreed on 2026-11-18 (Q1 to Q7 of that session, the recommended answer each time). Still to do by a person: run Private with the real on-device model and read how the plans sound (a stub can't tell).

As built, these details differ from the draft below:
- **The closing line in Private is always the fixed one** ("If after a couple of weeks things feel the same or heavier, it is worth talking to a counselor or doctor."), not written by a last job: safety wording shouldn't depend on a small model.
- **Private uses one job per week with 2 activities each** (the cloud way gives 2 or 3).
- **A week that still can't be read as activities** is shown as one plain-text card; a week with no words at all is left out; fewer than two weeks is an error.
- **"Reading your notes…"** shows no count when there is only one slice.
- **The header tag** on the page follows the way picked ("Private · on your device" or "Cloud · asks you first").
- Checked in headless Chrome with a stand-in for the on-device model: 37 checks on the Private way (desktop and phone: no network request at all, 6 jobs for a one-slice plan, week 4 sees earlier themes, finished weeks stay while the next is written, label and saved mode), plus not-downloaded-yet (progress bar), browser-can't-run (Private greyed out), model failure (an error, not a stuck spinner), a crisis answer (no job runs), and reduced motion.

### What changes

- On the Small steps start screen, **two plain options** above "Get started": **Private** ("Written on your device. Nothing leaves your computer. Simpler plans.") and **Cloud** ("Written by the cloud model, with a preview first. More detailed plans."). One is picked at a time, no colours. The choice is remembered on this device (part of `haven.stepsChoices`, so it is in backups and wiped by Delete everything). **Private is the default.**
- **Cloud is unchanged**: 2 requests, the shield preview each time, streaming, up to 3,000 words of notes.
- **If the private model isn't ready:** "Get started" starts it, with the same progress bar as Chat (it must come from a click). If this browser can't run it at all, Private is greyed out with one line saying why, and Cloud is picked for the person.

### How Private works (a chain of small on-device jobs)

Chrome's built-in model has a small memory and runs one job at a time, so the "multiple agents" are sequential, each with a small, focused prompt.

1. **Understand.** The gathered notes (up to about **1,500 words**, About me first as now) are cut into slices of about 400 words. Each slice gets its own job: "summarise what seems to be going on, in the third person, no names". A **combiner** job joins the slice summaries into one short summary. A **questions** job then writes 3 to 5 questions from that summary. The same two fixed questions are added as now. With no notes, it goes straight to the generic questions.
2. **Answers.** Unchanged, including the crisis check on every answer (nothing runs when one matches).
3. **Plan.** **One job per week, 4 in all, one after another.** Each gets: the summary, the answers, 2 or 3 matching library ideas (matched on the device as now, a different share for each week), and the **themes of the weeks already written**, so the weeks build gently and don't repeat. Each week appears on screen as soon as it is finished (and streams while it is written). A last small job writes the closing line, or a fixed closing line is used if it fails.
- **No shield preview and no permission step** in Private: nothing leaves the device. The privacy shield isn't involved.
- **Bad output:** a week or slice that comes back in the wrong shape is retried once. If it still fails, that week is shown as plain text, and the plan carries on. Replies go through the same on-device clean-up as chat (no bold or headings).
- The same rules go into every job: nothing tied to the hurt or a shared past, nothing the person said they'd rather avoid, no medication, therapy or treatment, no goals, streaks or reminders, no diagnosis.

### The loading animation (both modes, both stages)

- **Three softly pulsing dots** with a plain line beside them, in the calm style of the rest of the app. Examples: "Reading your notes… (2 of 4)", "Thinking of questions…", "Writing week 2 of 4…", "Waiting for the cloud…".
- Cloud: the dots show until the first words stream in. Private: each finished week stays on screen, with the dots and the next line below it.
- It **holds still** for people with reduced motion turned on; the text line still changes. Marked as a status for screen readers.
- The existing "Writing your plan…" heading is replaced by this.

### Labelling

- Under the closing line the saved plan says how it was made: **"Written privately on your device."** or **"Written with the cloud, with your permission."** A Private plan adds: "A simpler plan, written by a small model on your device."
- `SavedPlan` gets a `mode` field (`"private"` or `"cloud"`; older saved plans count as cloud). It is checked when a backup is restored.
- The footnote and the Settings privacy page are updated: Small steps can now run fully on the device. The README is updated too.

### Technical design

- `lib/smallSteps.ts`: slice the notes; the slice, combiner, questions and per-week instructions (the existing Cloud instructions are unchanged).
- `lib/privateSteps.ts` (new): runs the chain on the device using the existing on-device model calls; retry once; reports progress ("2 of 4") to the page; stops cleanly if the person leaves the page or starts over.
- `lib/plan.ts`: `mode` on the saved plan; weeks can be added one at a time as they finish.
- `lib/storage.ts`: the choice in the steps choices.
- `components/Loading.tsx` (new): the dots and line.
- `app/steps/page.tsx`: the two options, Private or Cloud paths through the three stages, the loading display. `PlanView.tsx`: the label.

### Testing

- Unit tests: slicing (about 400 words, nothing lost, About me first); the chain with a fake on-device model (slice, combine, questions, 4 weeks in order, each week sees the earlier themes); retry once then plain text; a stop mid-chain; crisis words in an answer stop it; the saved plan's `mode` (round trip, old plans read as cloud, backup restore).
- In headless Chrome: both options; Cloud still passes all of the existing 80 checks; Private with a stubbed on-device model through all three stages with **no network request at all**; the animation shows and changes its text, and holds still with reduced motion; model-not-ready start and the progress bar; browser-can't-run greys out Private; the label; light, dark and phone. I will look at the screenshots myself.
- A real run with the real on-device model is for a person to do. A stub can't tell how the small model sounds, so I will say plainly that I haven't heard it.

### Phases (stop after each for review)

1. **Logic.** Slicing, the Private chain, the instructions, the saved-plan `mode`, tests.
2. **Page.** The two options, both paths, the animation, the label, checks in Chrome.
3. **Docs.** README, privacy page, checklist, and the status at the top of this addendum.
