import type { ReactNode } from "react";

export const metadata = { title: "Small steps · Haven" };

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
