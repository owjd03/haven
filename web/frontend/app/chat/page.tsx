"use client";

import { useAI } from "@/components/AIProvider";
import ChatView from "./ChatView";
import Welcome from "./Welcome";

/** Shows the welcome screen until the private model is ready (or the user opts into cloud-only), then the chat. */
export default function HomePage() {
  const { phase, cloudMode } = useAI();
  return phase === "ready" || cloudMode ? <ChatView /> : <Welcome />;
}
