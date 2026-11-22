import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HavenAIError,
  MESSAGES,
  isRetryable,
  statusOf,
  toHavenError,
  type AIErrorKind,
} from "../lib/aiErrors";

// The exact error a busy cloud produced on the live site.
const HIGH_DEMAND = new Error(
  "AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/haven-882c1/models/gemini-3.5-flash-lite:generateContent: [500 ] This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later. (AI/fetch-error)",
);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("what each kind of error becomes", () => {
  const cases: Array<[string, unknown, AIErrorKind, string]> = [
    ["the busy cloud that was seen live (500)", HIGH_DEMAND, "busy", MESSAGES.busy],
    ["a bare 503", Object.assign(new Error("x"), { status: 503 }), "busy", MESSAGES.busy],
    ["a 502", new Error("[502 Bad Gateway] upstream"), "busy", MESSAGES.busy],
    [
      "a rate limit (429)",
      new Error("[429 Too Many Requests] slow down"),
      "rate_limit",
      MESSAGES.busy,
    ],
    [
      "a 403 from App Check",
      new Error("[403 ] App Check token is invalid"),
      "denied",
      MESSAGES.denied,
    ],
    [
      "a 401",
      Object.assign(new Error("x"), { customErrorData: { status: 401 } }),
      "denied",
      MESSAGES.denied,
    ],
    [
      "the API not being enabled",
      new Error("AI: not enabled (AI/api-not-enabled)"),
      "denied",
      MESSAGES.denied,
    ],
    [
      "a safety block",
      new Error("Response was blocked due to SAFETY"),
      "blocked",
      MESSAGES.blocked,
    ],
    ["a 504", new Error("[504 ] gateway timeout"), "timeout", MESSAGES.timeout],
    ["a timeout", new Error("The request timed out"), "timeout", MESSAGES.timeout],
    ["no internet", new TypeError("Failed to fetch"), "offline", MESSAGES.offline],
    [
      "a fetch error with no status",
      new Error("AI: Error fetching (AI/fetch-error)"),
      "offline",
      MESSAGES.offline,
    ],
    [
      "the private model being unavailable",
      new Error("LanguageModel is unavailable"),
      "device_unavailable",
      MESSAGES.device,
    ],
    ["anything else", new Error("kaboom"), "unknown", MESSAGES.unknown],
    ["something that is not an Error", "oops", "unknown", MESSAGES.unknown],
    ["nothing at all", undefined, "unknown", MESSAGES.unknown],
  ];
  it.each(cases)("%s", (_name, input, kind, message) => {
    const e = toHavenError(input);
    expect(e).toBeInstanceOf(HavenAIError);
    expect(e.kind).toBe(kind);
    expect(e.message).toBe(message);
  });

  it("treats a missing connection as offline even without a clear message", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(toHavenError(new Error("something odd")).kind).toBe("offline");
  });

  it("gives an error that is already a HavenAIError back unchanged", () => {
    const own = new HavenAIError("unavailable", "Cloud features are switched off right now.");
    expect(toHavenError(own)).toBe(own);
  });
});

describe("what a person is shown", () => {
  const inputs = [
    HIGH_DEMAND,
    new Error("[403 ] App Check token is invalid"),
    new Error("Response was blocked due to SAFETY"),
    new TypeError("Failed to fetch"),
    new Error("kaboom at https://example.com/x (AI/error)"),
  ];
  it.each(inputs.map((i) => [String(i.message).slice(0, 40), i] as const))(
    "never includes a URL, a status code, an internal code or the original text: %s",
    (_n, input) => {
      const text = toHavenError(input).message;
      expect(text).not.toMatch(
        /https?:|AI\/|\[\d{3}|\b[45]\d\d\b|googleapis|gemini|kaboom|demand/i,
      );
      expect(text).not.toMatch(/\b(model|API|rate limit)\b/i);
      expect(text.length).toBeLessThan(120);
    },
  );

  it("is a short sentence for every kind of message", () => {
    for (const text of Object.values(MESSAGES)) {
      expect(text).toMatch(/[.]$/);
      expect(text).not.toMatch(/\b(model|API|rate limit)\b/i);
    }
  });

  it("logs the real error to the console for debugging", () => {
    toHavenError(HIGH_DEMAND);
    expect(console.warn).toHaveBeenCalledWith("[Haven] AI error:", HIGH_DEMAND);
  });
});

describe("statusOf and isRetryable", () => {
  it("reads a status from the library's fields or its message", () => {
    expect(statusOf(HIGH_DEMAND)).toBe(500);
    expect(statusOf(Object.assign(new Error("x"), { status: 429 }))).toBe(429);
    expect(statusOf(Object.assign(new Error("x"), { customErrorData: { status: 503 } }))).toBe(503);
    expect(statusOf(new Error("no number here"))).toBeUndefined();
  });

  it("retries a busy or briefly failing cloud, but not a rate limit or a refusal", () => {
    expect(isRetryable(HIGH_DEMAND)).toBe(true);
    expect(isRetryable(new Error("[503 ] x"))).toBe(true);
    expect(isRetryable(new Error("[502 ] x"))).toBe(true);
    expect(isRetryable(new Error("[429 ] x"))).toBe(false);
    expect(isRetryable(new Error("[403 ] x"))).toBe(false);
    expect(isRetryable(new Error("Failed to fetch"))).toBe(false);
  });
});
