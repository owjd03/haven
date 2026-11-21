import { notFound } from "next/navigation";
import Phase1Demo from "@/components/Phase1Demo";

export const metadata = { title: "Debug · Haven" };

// Developer panel. Works with `npm run dev`; hidden in production builds.
export default function DebugPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Phase1Demo />;
}
