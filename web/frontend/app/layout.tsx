import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import AIProvider from "@/components/AIProvider";
import CrisisProvider from "@/components/CrisisProvider";
import ShieldProvider from "@/components/ShieldProvider";
import Shell from "@/components/Shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif-source",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Haven",
  description: "A private, on-device-first wellness companion.",
};

// Applies the saved appearance before first paint, so there is no flash of the wrong theme.
const APPEARANCE_INIT = `try{var d=document.documentElement;if(localStorage.getItem("haven.theme")==="dark")d.setAttribute("data-theme","dark");var t=localStorage.getItem("haven.textSize");if(t==="large"||t==="small")d.setAttribute("data-text",t);}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT }} />
      </head>
      <body className="min-h-full">
        <AIProvider>
          <CrisisProvider>
            <ShieldProvider>
              <Shell>{children}</Shell>
            </ShieldProvider>
          </CrisisProvider>
        </AIProvider>
      </body>
    </html>
  );
}
