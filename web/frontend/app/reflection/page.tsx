"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Weekly reflection became Insights. On the hosted site firebase.json forwards
// this address; this page does the same for `npm run dev` and old bookmarks.
export default function ReflectionMoved() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/insights");
  }, [router]);

  return (
    <p className="p-6 text-center text-muted">
      This page moved to{" "}
      <Link href="/insights" className="underline">
        Insights
      </Link>
      .
    </p>
  );
}
