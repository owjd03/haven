/**
 * How "random" each model's wording is. Higher temperature and topK give more varied replies;
 * lower values give steadier, more repeatable ones. All the numbers live here so they are easy to tune.
 *
 * - chat: a little varied so replies don't all open the same way, but low enough that the small
 *   model keeps to the writing rules (it was 0.8, and slipped more often).
 * - summary: faithful, since summaries and personal-detail detection should not wander.
 * - cloud: one setting for Insights, the drafter and cloud chat.
 */
export const SAMPLING = {
  chat: { temperature: 0.6, topK: 30 },
  summary: { temperature: 0.2, topK: 3 },
  cloud: { temperature: 0.7 },
} as const;

export interface Sampling {
  temperature: number;
  topK: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Turns what Chrome says it supports (`LanguageModel.params()`) into options that are safe to pass.
 * Returns null if Chrome gave no usable limits, so the caller leaves the model at its defaults.
 * Chrome wants temperature and topK together, so both are always returned together.
 */
export function resolveSampling(
  params: unknown,
  want: { temperature: number; topK: number },
): Sampling | null {
  if (typeof params !== "object" || params === null) return null;
  const p = params as Record<string, unknown>;
  if (!finite(p.maxTemperature) || !finite(p.maxTopK) || p.maxTopK < 1) return null;
  return {
    temperature: Math.min(Math.max(want.temperature, 0), p.maxTemperature),
    topK: Math.min(Math.max(Math.round(want.topK), 1), Math.floor(p.maxTopK)),
  };
}
