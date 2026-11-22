// Turns any error from the AI library into one short message a person can act on.
//
// No Firebase code is imported here, so this file is easy to test. Nothing from the original error
// (its text, a URL, a status code) is ever put on screen. The full error goes to the browser console,
// where it can be read while debugging.

export type AIErrorKind =
  | "rate_limit"
  | "busy"
  | "unavailable"
  | "device_unavailable"
  | "offline"
  | "denied"
  | "blocked"
  | "timeout"
  | "unknown";

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

export const MESSAGES = {
  busy: "The cloud is busy right now, so that didn't go through. Please try again in a minute.",
  offline: "Haven couldn't reach the internet. Check your connection and try again.",
  denied:
    "Cloud features aren't available right now. Everything private on your device still works.",
  blocked: "I couldn't write a reply to that one. Try wording it a little differently.",
  timeout: "That took too long. Please try again.",
  device: "Haven's private chat isn't available right now.",
  unknown: "Something went wrong on our side. Please try again in a moment.",
} as const;

/** The HTTP status behind an error, if the library or its message gives one. */
export function statusOf(e: unknown): number | undefined {
  const anyE = e as { customErrorData?: { status?: number }; status?: number; message?: string };
  if (typeof anyE?.customErrorData?.status === "number") return anyE.customErrorData.status;
  if (typeof anyE?.status === "number") return anyE.status;
  const message = typeof anyE?.message === "string" ? anyE.message : "";
  // The library writes "[500 ]" or "[429 Too Many Requests]" into its messages.
  const bracket = /\[(\d{3})\b/.exec(message);
  if (bracket) return Number(bracket[1]);
  const bare = /\b(429|503)\b/.exec(message);
  return bare ? Number(bare[1]) : undefined;
}

/** A busy or briefly failing cloud is worth trying again. A real rate limit (429) is not. */
export function isRetryable(e: unknown): boolean {
  const s = statusOf(e);
  return s === 500 || s === 502 || s === 503;
}

function messageOf(e: unknown): string {
  const m = (e as { message?: unknown })?.message;
  return typeof m === "string" ? m : String(e);
}

export function toHavenError(e: unknown): HavenAIError {
  if (e instanceof HavenAIError) return e;
  // For whoever is debugging: the real error, in the console only.
  console.warn("[Haven] AI error:", e);

  const status = statusOf(e);
  const msg = messageOf(e);
  const err = (kind: AIErrorKind, text: string) => new HavenAIError(kind, text, e);

  if (status === 429) return err("rate_limit", MESSAGES.busy);
  if (status === 500 || status === 502 || status === 503) return err("busy", MESSAGES.busy);
  if (status === 504 || status === 408) return err("timeout", MESSAGES.timeout);
  if (status === 401 || status === 403) return err("denied", MESSAGES.denied);

  if (/app.?check|api-not-enabled|permission.?denied|api.?key/i.test(msg))
    return err("denied", MESSAGES.denied);
  if (/blocked|safety|prohibited|recitation/i.test(msg)) return err("blocked", MESSAGES.blocked);
  if (/timed? ?out|timeout|aborterror/i.test(msg)) return err("timeout", MESSAGES.timeout);
  if (
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    /failed to fetch|network ?error|network request failed|load failed|fetch-error/i.test(msg)
  )
    return err("offline", MESSAGES.offline);
  if (/on-device|on_device|device model|LanguageModel|unavailable/i.test(msg))
    return err("device_unavailable", MESSAGES.device);
  return err("unknown", MESSAGES.unknown);
}
