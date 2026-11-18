"use client";

import { LOCAL_HOTLINES, parseHotlines, type HotlineData } from "@haven/backend";
import { getRemoteHotlines } from "./remoteConfig";

/**
 * Hotline data for the crisis screen: Firebase Remote Config (key hotlines_json) when it
 * answers quickly and validates, otherwise the bundled JSON, so the crisis screen always works offline.
 */
export async function loadHotlines(): Promise<HotlineData> {
  const remote = await Promise.race([
    getRemoteHotlines().then((raw) => (raw ? parseHotlines(raw) : null)),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
  ]).catch(() => null);
  return remote ?? LOCAL_HOTLINES;
}

export function guessCountryCode(data: HotlineData): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (region && data.countries.some((c) => c.code === region)) return region;
  } catch {
    /* fall through */
  }
  return "OTHER";
}
