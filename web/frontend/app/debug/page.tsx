import { notFound } from "next/navigation";

export const metadata = { title: "Debug · Haven" };

// Developer panel. Works with `npm run dev`. In production builds the branch below is
// removed, so the panel's code is not shipped and the page is a 404.
export default async function DebugPage() {
  if (process.env.NODE_ENV !== "production") {
    const { default: Phase1Demo } = await import("@/components/Phase1Demo");
    return <Phase1Demo />;
  }
  notFound();
}
