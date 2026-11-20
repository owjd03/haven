# Hackathon checklist (#BuildHybridAI 2026)

Deadline: **Mon Nov 30, 2026, 2:00 PM PT**. Items marked "verified" were checked in the repo; items marked "you" need a human.

## Hard rules
| # | Rule | Status |
| --- | --- | --- |
| 1 | All AI inference through `firebase/ai`; no other model API, no embedding model | Verified: grep finds no OpenAI/Anthropic/other SDKs or REST calls; only `lib/ai.ts` and `lib/firebase.ts` import `firebase/ai` |
| 2 | No backend server; Firebase AI code in client components | Verified: no `app/api`, route handlers, middleware or server actions; `lib/ai.ts`, `lib/firebase.ts`, `lib/remoteConfig.ts` start with `"use client"` |
| 3 | No committed secrets; `.env.example` placeholders only | Verified: `.env.local` is gitignored; no API key or debug token appears in any non-ignored file; `.env.example` has empty values |
| 4 | Public-ready, Apache-2.0 `LICENSE` at the root | Verified: `LICENSE` present. **You:** confirm the hackathon accepts Apache-2.0 and that the repo is public |
| 5 | Firebase AI Logic imported and called at runtime | Verified: `getAI`, `getGenerativeModel`, `initializeDeviceModel`, `generateContent(Stream)` in `lib/ai.ts`; confirmed working on-device and in the cloud during setup |
| 6 | Works in English | Verified: all UI text and prompts are English; language options pinned to `en` |

## Product requirements
- [x] On-device chat via Gemini Nano (Firebase AI Logic hybrid), `initializeDeviceModel()` from a click with a progress bar
- [x] Three model objects (`chatModel`, `summaryModel`, `cloudModel`) in `lib/ai.ts`
- [x] Prompt builder (mode instruction, profile, structured summary, "last talked", last 8 messages, cards in Help mode only, message) within 900 words, with a 450-word shrink-and-retry; the summary folds in 8 messages at a time
- [x] Coping cards + keyword retrieval (92 cards, no embeddings, no runtime scraping), flagged `reviewed: false`; 64 of 92 source-checked against credible pages on 2026-11-16 (18 reworded), 28 still have no verified source
- [x] Privacy shield: regex + model detection, placeholders, preview dialog with tap-to-mask/unmask, local un-masking, graceful failure
- [x] Weaker-detection warning + explicit consent when the private model is unavailable; raw text never sent
- [x] Consent and fallback dialog; status badge
- [x] Crisis detection in plain code before any model call; support screen with location box and country selector; hotlines (scraped, with source and date shown) from JSON, Remote Config first
- [x] Persistent disclaimer footer
- [x] Profile page, export / restore (validated) / clear app cache / delete everything, "How Haven handles your data" page
- [x] Reply modes: Just listen (default) and Help me think, saved on-device; clear asks switch for one reply; one-time offer of ideas
- [x] Memory: structured summary, time awareness after 6+ hours, suggested memories with Keep / Not now (on-device only, no health facts, never in the cloud path)
- [x] Journal (private): sticky-note board with a New note popup (button or click on the board), 1 to 10 mood, paper colour, automatic date, edit/delete, crisis check on save (support screen first, optional private save, never sent to any AI)
- [x] Insights (cloud, on request): 7 or 30 days of journal, chats or both, with the low-mood note; message drafter; all through the shield preview
- [x] Small steps (Private on-device, or Cloud on request; the person picks): a 4-week plan built in three stages (notes to a summary and questions, the person's answers, then the plan streamed live), grounded in a researched, source-linked library of 49 plan ideas (docs/plan-ideas.md); both previews go through the shield; crisis check on answers; the private way is a chain of small on-device jobs (slices of notes, then one job per week) with no network; a calm loading animation; saved and deletable on this device; no tracking, goals or reminders
- [x] Remote Config: `hotlines_json` and `cloud_enabled` kill switch
- [x] App Check debug provider on localhost (token never hardcoded)
- [x] Light by default; dark mode and the text size (smaller by default, normal, larger) and the font (five choices) are manual choices in Settings (with Data & privacy). Keyboard navigation, aria labels, typing indicator, error and empty states, 3-step first-run intro
- [x] Soft palette with enforced contrast (tests), no pressure mechanics, plain warm copy (audited)
- [x] Tests (Vitest, Firebase AI mocked), README, LICENSE

## Before you submit (you)
1. **Hotlines:** the data was scraped from Wikipedia (202 countries/territories). Spot-check the countries that matter for your audience against official sources; re-run `tools/hotlines/build_hotlines.py` to refresh.
2. **Coping cards:** the 28 cards without `sourceChecked` in `web/backend/data/copingCards.json` still need a source (start with the sensitive ones: `sexual-assault`, `partner-cheated`, `emotional-cheating`). Also consider a crisis-line link next to `hopeless-feelings-shift`. Only a person should set `reviewed: true`, ideally a counselor or clinician.
3. **Try the real flows in Chrome:** chat (streaming), a crisis phrase in chat and in a journal entry, the cloud fallback and shield preview, Insights (journal only, chats only, both, 7 and 30 days), the sticky-note board (empty-space click, Esc and outside-click with typed text, keyboard only, phone width, dark mode), message drafter, Settings (dark mode, smaller and larger text, backup / restore / clear cache / delete, including a backup that contains journal entries).
4. **Remote Config (optional):** publish `cloud_enabled` / `hotlines_json` to demo the kill switch.
5. **Repo:** make it public, confirm `.env.local` is not committed (`git status`), record the demo video.
6. Check the hackathon's own rules for anything beyond the list above (license, submission format, video, deployment requirements).

## Known gaps
- Streaming, the shield with the real on-device detector, and the cloud flows were built and unit-tested with mocks, but should be exercised once end to end in a real browser.
- Localhost-only: App Check uses debug tokens, so a public deployment would need a production provider.
- Keyword retrieval and keyword crisis detection are heuristics with known limits (see README).
- The design has not been user-tested; the README describes it as design principles, not health claims.
