"use client";

/**
 * Haven's single entry point to Firebase AI Logic (firebase/ai).
 * All inference (on-device Gemini Nano and cloud) goes through here.
 * Browser only: the on-device model exists only in Chrome.
 */

import {
  getGenerativeModel,
  InferenceMode,
  type GenerativeModel,
  type HybridParams,
} from "firebase/ai";
import { SAMPLING, resolveSampling, type Sampling } from "./sampling";
import { getFirebaseAI } from "./firebase";

export const CLOUD_MODEL = process.env.NEXT_PUBLIC_CLOUD_MODEL || "gemini-3.5-flash-lite";

export type InferenceSourceLabel = "on_device" | "in_cloud" | "unknown";
export interface AIResult {
  text: string;
  source: InferenceSourceLabel;
}

export type LocalStatus = "available" | "downloadable" | "downloading" | "unavailable";

export type AIErrorKind = "rate_limit" | "unavailable" | "device_unavailable" | "unknown";

export class HavenAIError extends Error {
  constructor(
    public kind: AIErrorKind,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "HavenAIError";
  }
}

// --- Model objects (one Firebase connection, separate model instances) ---

type OnDeviceParams = NonNullable<HybridParams["onDeviceParams"]>;

/** A fresh params object per model (the SDK fills in fields on the one it is given). */
function onDeviceParamsFor(sampling: Sampling | null): OnDeviceParams {
  return {
    // temperature/topK are real Chrome options but missing from the SDK's types, hence the cast.
    createOptions: {
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      ...(sampling ?? {}),
    } as OnDeviceParams["createOptions"],
  };
}

/** Chrome's allowed ranges are read when the private model starts. null = leave Chrome's defaults. */
let localSampling: { chat: Sampling | null; summary: Sampling | null } = {
  chat: null,
  summary: null,
};

interface Models {
  chat: GenerativeModel;
  summary: GenerativeModel;
  cloud: GenerativeModel;
}
let models: Models | undefined;

function getModels(): Models {
  if (!models) {
    const ai = getFirebaseAI();
    models = {
      chat: getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_ON_DEVICE,
        onDeviceParams: onDeviceParamsFor(localSampling.chat),
      }),
      summary: getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_ON_DEVICE,
        onDeviceParams: onDeviceParamsFor(localSampling.summary),
      }),
      cloud: getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: CLOUD_MODEL,
          generationConfig: { temperature: SAMPLING.cloud.temperature },
        },
      }),
    };
  }
  return models;
}

// --- Local model availability / init ---

interface LanguageModelGlobal {
  availability(options?: unknown): Promise<string>;
  /** Chrome's default and maximum temperature/topK. Missing or null in some versions. */
  params?(): Promise<unknown>;
}

/** Chrome Prompt API availability (Firebase has no separate availability call). */
export async function getLocalStatus(): Promise<LocalStatus> {
  const LM = (globalThis as unknown as { LanguageModel?: LanguageModelGlobal }).LanguageModel;
  if (!LM) return "unavailable";
  try {
    const s = await LM.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
    if (s === "available" || s === "downloadable" || s === "downloading") return s;
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function isLocalAvailable(): Promise<boolean> {
  return localReady || (await getLocalStatus()) === "available";
}

let localReady = false;
let initPromise: Promise<void> | undefined;

/**
 * Must be called from a user interaction (e.g. the "Start chatting" button).
 * onProgress receives 0..1 while Gemini Nano downloads.
 */
export function initLocalModel(onProgress?: (fraction: number) => void): Promise<void> {
  if (localReady) return Promise.resolve();
  if (!initPromise) {
    initPromise = (async () => {
      if ((await getLocalStatus()) === "unavailable") {
        throw new HavenAIError(
          "device_unavailable",
          "Your device can't run the private on-device model.",
        );
      }
      const start = async () => {
        const { chat, summary } = getModels();
        await chat.initializeDeviceModel(onProgress);
        // Same underlying Chrome model: should resolve immediately, no download.
        await summary.initializeDeviceModel();
      };
      try {
        // Ask Chrome what it allows, then set the models' randomness inside those limits.
        const LM = (globalThis as unknown as { LanguageModel?: LanguageModelGlobal }).LanguageModel;
        const params = await LM?.params?.().catch(() => null);
        localSampling = {
          chat: resolveSampling(params, SAMPLING.chat),
          summary: resolveSampling(params, SAMPLING.summary),
        };
        models = undefined; // rebuild with the options above
        try {
          await start();
        } catch (e) {
          // If Chrome refuses the sampling options, chat must still work: retry with its defaults.
          if (!localSampling.chat && !localSampling.summary) throw e;
          if (process.env.NODE_ENV === "development") {
            console.warn("[Haven] Chrome rejected temperature/topK, using its defaults.", e);
          }
          localSampling = { chat: null, summary: null };
          models = undefined;
          await start();
        }
        localReady = true;
      } catch (e) {
        throw toHavenError(e);
      }
    })().finally(() => {
      if (!localReady) initPromise = undefined;
    });
  }
  return initPromise;
}

// --- Error handling ---

function statusOf(e: unknown): number | undefined {
  const anyE = e as { customErrorData?: { status?: number }; status?: number; message?: string };
  if (typeof anyE?.customErrorData?.status === "number") return anyE.customErrorData.status;
  if (typeof anyE?.status === "number") return anyE.status;
  const m = /\b(429|503)\b/.exec(anyE?.message ?? "");
  return m ? Number(m[1]) : undefined;
}

export function toHavenError(e: unknown): HavenAIError {
  if (e instanceof HavenAIError) return e;
  const status = statusOf(e);
  const msg = (e as Error)?.message ?? String(e);
  if (status === 429) {
    return new HavenAIError(
      "rate_limit",
      "The cloud is a bit busy right now (rate limit). Please wait a minute and try again.",
      e,
    );
  }
  if (status === 503) {
    return new HavenAIError(
      "unavailable",
      "The cloud model is temporarily unavailable. Please try again soon.",
      e,
    );
  }
  if (/on-device|on_device|device model|LanguageModel|unavailable/i.test(msg)) {
    return new HavenAIError(
      "device_unavailable",
      "The private on-device model isn't available right now.",
      e,
    );
  }
  // Surface the real cause in dev so setup problems (API not enabled, App Check, bad model) are visible.
  if (process.env.NODE_ENV === "development") {
    console.error("[Haven AI error]", e);
    return new HavenAIError(
      "unknown",
      `Something went wrong talking to the model. (dev detail: ${msg})`,
      e,
    );
  }
  return new HavenAIError("unknown", "Something went wrong talking to the model.", e);
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let delay = 800;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (statusOf(e) === 503 && attempt < retries) {
        await new Promise((r) => setTimeout(r, delay + Math.random() * 250));
        delay *= 2;
        continue;
      }
      throw toHavenError(e);
    }
  }
}

async function run(model: GenerativeModel, prompt: string): Promise<AIResult> {
  return withRetry(async () => {
    const result = await model.generateContent(prompt);
    const src = result.response.inferenceSource;
    return {
      text: result.response.text(),
      source: src === "on_device" ? "on_device" : src === "in_cloud" ? "in_cloud" : "unknown",
    };
  });
}

// --- Public API ---

/** Daily chat. On-device only. Callers must run the crisis check first. */
export function chat(prompt: string): Promise<AIResult> {
  return run(getModels().chat, prompt);
}

/** Compress older messages into a structured rolling summary. On-device only. */
export function summarize(text: string): Promise<AIResult> {
  return run(
    getModels().summary,
    "Update a private memory note about a conversation between a person and Haven, a supportive companion. " +
      "Write exactly these five lines, each starting with its label, in third person, in short phrases, under 120 words in total. " +
      "Write none for a line that doesn't apply.\n" +
      "Going on: what is happening in their life\n" +
      "Feeling: how they have been feeling\n" +
      "Tried / didn't help: things they tried that did not work\n" +
      "Helped: things that helped\n" +
      "Open threads: things still undecided or coming up, like an exam or a decision\n" +
      "Keep details from the previous note unless they are clearly resolved. No advice.\n\n" +
      text,
  );
}

/**
 * Looks for ONE lasting fact in a user's message, on-device only. The caller must vet the answer
 * (see vetMemory) before showing it, and the person decides whether to keep it.
 */
export function extractMemory(message: string): Promise<AIResult> {
  return run(
    getModels().summary,
    "Read the message below. If it states ONE lasting fact about the person's life that a friend would want to remember " +
      "(an upcoming event with its day, someone's name and role, a school subject or job, a decision they face), " +
      "write it as one short phrase of at most 12 words, in third person. " +
      "Do not include moods or feelings that will pass, and nothing about health or medical matters. " +
      "If there is no such fact, write exactly: none\n\nMessage:\n" +
      message,
  );
}

/** One general on-device job (Small steps, private): no crisis check here, the caller does that. */
export function localGenerate(prompt: string): Promise<AIResult> {
  return run(getModels().summary, prompt);
}

/** Streaming on-device job: `onPartial` receives the full text so far. */
export async function localGenerateStream(
  prompt: string,
  onPartial: (textSoFar: string) => void,
): Promise<AIResult> {
  try {
    const result = await getModels().summary.generateContentStream(prompt);
    let text = "";
    for await (const chunk of result.stream) {
      text += chunk.text();
      onPartial(text);
    }
    const resp = await result.response;
    if (!text) text = resp.text();
    return { text, source: "on_device" };
  } catch (e) {
    throw toHavenError(e);
  }
}

/** Streaming variant of chat(): `onPartial` receives the full text so far as it is generated. */
export async function chatStream(
  prompt: string,
  onPartial: (textSoFar: string) => void,
): Promise<AIResult> {
  try {
    const result = await getModels().chat.generateContentStream(prompt);
    let text = "";
    for await (const chunk of result.stream) {
      text += chunk.text();
      onPartial(text);
    }
    const resp = await result.response;
    if (!text) text = resp.text();
    const src = resp.inferenceSource;
    return {
      text,
      source: src === "on_device" ? "on_device" : src === "in_cloud" ? "in_cloud" : "unknown",
    };
  } catch (e) {
    throw toHavenError(e);
  }
}

export interface DetectedEntities {
  people: string[];
  places: string[];
  organizations: string[];
}

/** Detect personal details with the on-device model (used by the privacy shield). */
export async function detectEntities(text: string): Promise<DetectedEntities> {
  // TODO(Phase 4): switch to structured output (responseSchema) once verified on-device.
  const { text: out } = await run(
    getModels().summary,
    `List the personal details in the text below as JSON with exactly these keys: ` +
      `"people" (first/last names), "places" (cities, countries, addresses, landmarks), ` +
      `"organizations" (schools, universities, employers, companies). ` +
      `Copy each item exactly as written. Use [] if none. Output only JSON.\n\nText:\n${text}`,
  );
  const empty: DetectedEntities = { people: [], places: [], organizations: [] };
  const match = /\{[\s\S]*\}/.exec(out);
  if (!match) return empty;
  try {
    const j = JSON.parse(match[0]) as Partial<Record<keyof DetectedEntities, unknown>>;
    const arr = (v: unknown) =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : [];
    return { people: arr(j.people), places: arr(j.places), organizations: arr(j.organizations) };
  } catch {
    return empty;
  }
}

/**
 * Cloud generation. ONLY call after explicit user consent and the privacy-shield
 * preview, with already-masked text.
 */
export function cloudGenerate(prompt: string): Promise<AIResult> {
  return run(getModels().cloud, prompt);
}

/**
 * Streaming cloud generation: `onPartial` receives the full text so far as it arrives. Same rules as
 * cloudGenerate: only after consent and the preview, with already-masked text.
 */
export async function cloudGenerateStream(
  prompt: string,
  onPartial: (textSoFar: string) => void,
): Promise<AIResult> {
  try {
    const result = await getModels().cloud.generateContentStream(prompt);
    let text = "";
    for await (const chunk of result.stream) {
      text += chunk.text();
      onPartial(text);
    }
    const resp = await result.response;
    if (!text) text = resp.text();
    return { text, source: "in_cloud" };
  } catch (e) {
    throw toHavenError(e);
  }
}
