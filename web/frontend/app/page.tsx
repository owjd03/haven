"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Once the person has agreed, the front door is Chat. (Before that, Shell shows the opening page instead.) */
export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/chat");
  }, [router]);
  return null;
}
