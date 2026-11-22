"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

// Shown if some part of a page crashes. It never shows technical text. The detail goes to the console.
export default function ErrorScreen({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("[Haven] page error:", error);
  }, [error]);

  return (
    <div className="mx-auto mt-16 max-w-md px-4 text-center">
      <h1 className="text-xl font-medium">Something went wrong on our side.</h1>
      <p className="mt-2 text-muted">
        Your notes are safe on this device. Reload the page to continue.
      </p>
      <Button className="mt-6" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
