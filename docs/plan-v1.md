# Haven — Plan v1

> **Status:** all seven phases are implemented. This file is the original plan; see [README.md](../README.md) for the current state and [hackathon-checklist.md](hackathon-checklist.md) for the submission checklist.

Privacy-first mental wellness companion for the #BuildHybridAI 2026 hackathon (Firebase AI Logic).
**Deadline: Mon Nov 30, 2026, 2:00 PM PT.** Favor a finished, polished, working app over extra features.

## Product summary

Haven is a supportive companion (NOT therapy, NOT diagnosis) for students and young adults dealing with stress and tough times.

- Chat runs **on-device by default** (Gemini Nano via Chrome's Prompt API, through Firebase AI Logic).
- The cloud is used **only with explicit consent**.
- Before anything goes to the cloud, a **privacy shield** masks personal details (names, places, schools, employers, emails, phone numbers) and shows a preview of exactly what the cloud will see. The reply is un-masked locally.

## Hard rules

1. All AI inference goes through the Firebase AI Logic SDK (`firebase/ai`). No other model API, no separate embedding model.
2. No backend server. Next.js frontend only. Code touching Firebase AI lives in client components (`"use client"`).
3. Never commit secrets: no `.env` files, service account keys, or App Check debug tokens. Provide `.env.example` (placeholders only); gitignore real env files and debug tokens.
4. Repo is public-ready with an Apache-2.0 `LICENSE` at the root.
5. Firebase AI Logic is imported and actually called at runtime.
6. The app works in English.

## Firebase agent skills

- Plugin installed: `firebase@firebase` v1.1.0 (marketplace `firebase/agent-skills`).
- Use the relevant Firebase skill for any Firebase task (setup, AI Logic, App Check, Remote Config, init).
- If a skill or the current docs conflict with this plan, prefer the skill/docs and tell the user first.
- Stay within the stack. **Do NOT add Firestore, Authentication, or any server-side Firebase product** without approval — nothing is stored on a server.

## Tech stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Firebase JS SDK: `firebase/app`, `firebase/ai`, `firebase/app-check`, `firebase/remote-config`
- Gemini Developer API backend (`GoogleAIBackend`), free Spark plan
- IndexedDB via `idb` for messages, summaries, coping cards
- localStorage only for profile, settings, consent flags
- Small client-side keyword search for retrieval (hand-written or `minisearch`)

## Verified against docs (2026-11-14)

| Topic | Finding |
| --- | --- |
| Packages | `firebase` (SDK ≥ 12.5.0 for on-device; ≥ 12.14.0 for limited-use App Check tokens) |
| Init | `getAI(app, { backend: new GoogleAIBackend() })`, `getGenerativeModel(ai, { mode: InferenceMode.X })` |
| Modes | `PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD` |
| Device init | **Method** on the model: `model.initializeDeviceModel(onProgress?: (v: number) => void)`; progress 0–1; requires a user gesture |
| Availability | No Firebase API; use Chrome's `LanguageModel.availability()` (`available` / `downloading` / `downloadable`) |
| Chrome | Desktop Chrome 139+, flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, restart after enabling |
| On-device limits | Single-turn text only (no chat), structured JSON output supported, 9,216-token max |
| Free cloud models | `gemini-4-hydrogen`, `gemini-3.8-flash`, `gemini-3.5-flash-lite` (default) — no billing required |
| App Check | Debug: `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` before `initializeAppCheck`; enforcement required from Nov 2, 2026 |

### Deviations from the original brief (need user approval)

1. `initializeDeviceModel` is a model method; call once on `chatModel` (shared Chrome model — to be tested).
2. `isLocalAvailable()` is built on `LanguageModel.availability()` plus error handling.
3. Only the `prompt-api-for-gemini-nano-multimodal-input` flag is confirmed by docs; "Gemma 4 for Built-in AI" is documented but marked unverified.
4. Cloud model: `gemini-3.5-flash-lite`, name configurable via Remote Config (skill requires Gemini 3+).
5. Production App Check needs a real provider (e.g. reCAPTCHA Enterprise); debug tokens work on localhost only. Decision: localhost-only, so skipped.
6. `useLimitedUseAppCheckTokens: true` — skill says needed to avoid 403; docs say replay-protection only. Test both.
7. Remote Config skill only covers Android/iOS; use web docs.
8. `npx -y firebase-tools@latest init ailogic` is mandatory and needs a logged-in CLI and a project.

## Architecture

### Repo layout (decided after Phase 1)

```
Haven/
  docs/                  plans and notes
  LICENSE                Apache-2.0
  web/                   npm workspaces root
    frontend/            Next.js app: UI, Firebase AI Logic (lib/ai.ts, lib/firebase.ts), storage, shield
    backend/             @haven/backend: knowledge layer (coping cards + retrieval/RAG)
```

- **"Backend" is a browser-side package, not a server.** `web/backend` is pure TypeScript with no network and no Firebase. The frontend imports it as `@haven/backend`. This keeps the "no backend server" rule and the privacy promise: retrieval takes the user's chat message, so it must never leave the device.
- Frontend owns everything that touches Firebase, React, IndexedDB and the UI. Backend owns coping-card data and retrieval scoring (and is easy to unit test).
- Paths in the rest of this plan (`lib/...`, `/data/...`) are relative to the owning package: `lib/ai.ts` → `web/frontend/lib/ai.ts`; `copingCards.json` and `retrieval.ts` → `web/backend/`.

### Model instances (`lib/ai.ts`)

One Firebase connection, separate model objects:

- `chatModel` — `ONLY_ON_DEVICE`, daily chat.
- `summaryModel` — `ONLY_ON_DEVICE`, rolling summary and entity detection (structured JSON).
- `cloudModel` — `ONLY_IN_CLOUD`, only after consent: weekly reflection and message drafter.

Exposed functions: `initLocalModel(onProgress)`, `isLocalAvailable()`, `chat(prompt)`, `summarize(text)`, `detectEntities(text)`, `cloudGenerate(prompt)`.

- `initializeDeviceModel()` is called from a "Start chatting" button, with a progress bar.
- Errors: retry 503 with exponential backoff, friendly message on 429, handle "model unavailable".

### Prompt builder (`lib/promptBuilder.ts`)

The local model is single-turn, so each request is assembled from:

1. Short system instruction (warm, gentle, companion not therapist, never diagnose, no medical advice, suggest professional help when appropriate, short replies, at most one gentle question; if asked for a diagnosis, say it can't diagnose and suggest a professional).
2. User profile (editable key facts).
3. Rolling summary of older conversation.
4. Last ~6 messages.
5. 1–2 retrieved coping cards, if relevant.
6. The new user message.

Target ~450 words total. When unsummarized messages exceed a threshold (~12), `summaryModel` merges the oldest into the rolling summary.

### Retrieval (`lib/retrieval.ts`)

- ~25 coping cards in `/data/copingCards.json`: `{ id, title, tags, text, source: { name, url }, reviewed: false }`.
- Topics: panic/anxiety, grounding, breathing, exam stress, loneliness, sleep trouble, grief, burnout, anger, procrastination, family conflict, self-criticism, overwhelm.
- Written in my own words as general, safe, non-clinical techniques. Sources are `TODO: verify against source` placeholders; the user verifies. No runtime scraping.
- Simple keyword scoring against tags and text. No embeddings.

### Privacy shield (`lib/shield.ts`)

1. Take the text to send.
2. Detect personal details: regex first (emails, phones, URLs), then `summaryModel` with structured JSON (names, places, orgs, schools). Merge.
3. Replace each unique detail with a stable placeholder (`[PERSON_1]`, `[PLACE_1]`, `[ORG_1]`, `[EMAIL_1]`). The map is in memory only.
4. `PreviewDialog`: side-by-side "What you wrote" / "What the cloud will see", masked items highlighted; tap a word to mask, tap a placeholder to unmask. Buttons: "Send to cloud", "Cancel".
5. On confirm only, call `cloudModel` with masked text; the system instruction tells it to keep placeholders exactly.
6. Un-mask the reply locally; fail gracefully if a placeholder is missing or altered.

If the local model is unavailable: regex-only masking, a clear warning that detection is weaker, explicit consent, and the manual-masking preview. Raw text is never sent to the cloud.

### Consent and fallback

- Default chat is local only.
- If the local model is unavailable or errors: "Your device can't run the private model. Send this message to the cloud instead?" Accept → shield preview first. Decline → help on enabling Chrome's local model.
- Status badge always shows "Running privately on your device" or "Using cloud (with your permission)".
- Cloud features are opt-in per use, always through the shield preview.

### Crisis safety (`lib/crisis.ts`) — plain code, not AI

- Before any model call, rule-based check for self-harm/suicide language (broad list, including indirect phrases like "don't want to be here anymore", "end it all", "no point living").
- On match: no model call; show a fixed full-screen support view with a country selector, hotline info, and "talk to someone you trust now" guidance.
- Hotline data from `/data/hotlines.json` with clearly marked `TODO: verify` placeholders — **no invented phone numbers**. Loaded via Firebase Remote Config when possible, local JSON as fallback.
- Persistent footer: "Haven is a supportive companion, not a substitute for professional care. It can't diagnose or treat."

### Data and storage

- IndexedDB: messages, summaries. localStorage: profile, settings, consent.
- Profile page: editable "what's going on" key facts.
- "Download my data" → `haven-backup.json`; "Restore from file" with validation.
- "Delete everything" wipes IndexedDB and localStorage after confirmation.
- "How Haven handles your data" page: what stays on-device, exactly what can go to the cloud.

### Cloud features

- **Weekly reflection:** last 7 days of summaries → shield preview → `cloudModel` → patterns (hardest days, recurring themes) in gentle, non-diagnostic language.
- **Message drafter:** user describes recipient and intent → draft via cloud through the shield, preview approved first.

### Firebase setup

- Init from `NEXT_PUBLIC_FIREBASE_*` env vars (public web config only).
- App Check: debug provider on localhost; `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` in development only, before `initializeAppCheck`. README documents registering the token (Security > App Check > Apps > Manage debug tokens). Never hardcode a token.
- Remote Config: hotline list and a cloud-features kill switch, with local defaults.

## UI and design

- Calm, warm, accessible: soft colors, generous spacing, readable sizes, good contrast, keyboard navigation, aria labels, light and dark mode.
- Screens: Welcome (Start chatting + progress bar), Chat, Profile/Context, Weekly Reflection, Message Drafter, Data and Privacy, Crisis support.
- Mobile-friendly layout (on-device inference needs desktop Chrome).
- Typing indicator, error and empty states, 3-step first-run tutorial on the privacy model.

## Documentation

- README: what Haven is, why hybrid, mermaid architecture diagram, exact setup (Chrome version, both flags + restart, Firebase project, App Check debug token, env vars, optional skills install), how to run, how AI Logic is used (point to `lib/ai.ts`), privacy model, limitations and safety notes.
- Apache-2.0 `LICENSE`.

## Testing

Vitest unit tests with mocked Firebase AI calls for: crisis detection, prompt builder length/structure, retrieval scoring, shield mask/unmask round trip, export/import validation.

## Phases (stop after each for review and go-ahead)

1. **Scaffold and proof:** Firebase init, App Check debug, `lib/ai.ts` with three models, minimal page with "Start chatting", progress bar, test prompt proving on-device and cloud both work.
2. **Chat core:** Chat UI, IndexedDB, profile, prompt builder, rolling summary.
3. **Safety and retrieval:** Coping cards and retrieval, crisis detection and support view, footer disclaimers.
4. **Privacy shield:** Shield, preview dialog, consent/fallback flow, status badge.
5. **Cloud features:** Weekly reflection, message drafter, Remote Config.
6. **Data and polish:** Export/import/delete, privacy page, polish, accessibility, dark mode.
7. **Ship:** Tests, README, LICENSE, final checklist against hackathon requirements.

## Decisions

1. **Firebase project:** still open. User supplies an existing project ID, or asks me to create one (user must run `npx -y firebase-tools@latest login` first). Project ID is in Console > Project settings > General, or via `projects:list`.
2. **Cloud model:** `gemini-3.5-flash-lite` (SDK default, no billing). Cloud is only used for weekly reflection and the message drafter, not chat. Configurable via Remote Config; fall back to `gemini-3.8-flash` if output quality is poor.
3. **App Check:** localhost-only demo. Debug provider only; no reCAPTCHA Enterprise setup.
