import type { ReactNode } from "react";

export const metadata = { title: "About me · Haven" };

export default function Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
