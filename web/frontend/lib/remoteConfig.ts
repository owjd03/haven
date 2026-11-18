"use client";

import {
  fetchAndActivate,
  getRemoteConfig,
  getValue,
  isSupported,
  type RemoteConfig,
} from "firebase/remote-config";
import { getFirebaseApp, isFirebaseConfigured } from "./firebase";

/**
 * Firebase Remote Config: a cloud kill switch (cloud_enabled) and updatable hotline data
 * (hotlines_json). Everything has a safe local default, so Haven works offline and when
 * no template has been published.
 */
const DEFAULTS = { cloud_enabled: true, hotlines_json: "" };

let rcPromise: Promise<RemoteConfig | null> | undefined;

function init(): Promise<RemoteConfig | null> {
  if (!rcPromise) {
    rcPromise = (async () => {
      try {
        if (typeof window === "undefined" || !isFirebaseConfigured() || !(await isSupported()))
          return null;
        const rc = getRemoteConfig(getFirebaseApp());
        rc.settings.minimumFetchIntervalMillis =
          process.env.NODE_ENV === "development" ? 0 : 60 * 60 * 1000;
        rc.settings.fetchTimeoutMillis = 4000;
        rc.defaultConfig = DEFAULTS;
        await fetchAndActivate(rc).catch(() => false);
        return rc;
      } catch {
        return null;
      }
    })();
  }
  return rcPromise;
}

/** Warm the cache early (call on app start). Never throws. */
export function prefetchRemoteConfig(): void {
  void init();
}

/** False only if the kill switch is explicitly turned off in Remote Config. */
export async function isCloudEnabled(): Promise<boolean> {
  const rc = await init();
  if (!rc) return true;
  try {
    return getValue(rc, "cloud_enabled").asBoolean();
  } catch {
    return true;
  }
}

export async function getRemoteHotlines(): Promise<string | null> {
  const rc = await init();
  if (!rc) return null;
  try {
    return getValue(rc, "hotlines_json").asString() || null;
  } catch {
    return null;
  }
}
