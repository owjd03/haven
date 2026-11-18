"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from "firebase/app-check";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";

// Public web config only (safe to ship in the client bundle).
// NOTE: Next.js only inlines NEXT_PUBLIC_* vars when referenced statically.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

let appCheck: AppCheck | undefined;

function setupAppCheck(app: FirebaseApp): void {
  if (appCheck || typeof window === "undefined") return;

  // Haven's demo is localhost-only, so App Check always uses the DEBUG provider.
  // The SDK prints the generated token in the console; register it under
  // Firebase console > Security > App Check > Apps > Manage debug tokens.
  // Never hardcode a token: an optional stable one comes from a gitignored env file.
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (!isLocal) return;

  (
    self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }
  ).FIREBASE_APPCHECK_DEBUG_TOKEN = process.env.NEXT_PUBLIC_APP_CHECK_DEBUG_TOKEN || true;

  appCheck = initializeAppCheck(app, {
    // With a debug token set, the SDK skips real attestation; the provider's
    // site key is never contacted on localhost, so a placeholder is fine.
    provider: new ReCaptchaV3Provider("debug-placeholder-not-used"),
    isTokenAutoRefreshEnabled: true,
  });
}

export function getFirebaseApp(): FirebaseApp {
  if (typeof window === "undefined") {
    throw new Error("Firebase AI must only be used in the browser (client components).");
  }
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured. Copy .env.example to .env.local and fill it in.");
  }
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  setupAppCheck(app);
  return app;
}

let aiInstance: AI | undefined;

/** One Firebase AI Logic connection (Gemini Developer API, free Spark plan). */
export function getFirebaseAI(): AI {
  if (!aiInstance) {
    aiInstance = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
  }
  return aiInstance;
}
