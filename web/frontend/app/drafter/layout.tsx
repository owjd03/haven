import type { ReactNode } from "react";

export const metadata = { title: "Write a message · Haven" };

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
