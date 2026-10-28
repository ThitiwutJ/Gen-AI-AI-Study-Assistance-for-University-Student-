import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-thai/400.css";
import "@fontsource/ibm-plex-sans-thai/500.css";
import "@fontsource/ibm-plex-sans-thai/600.css";
import "@fontsource/ibm-plex-serif/400.css";
import "@fontsource/ibm-plex-serif/400-italic.css";
import "@fontsource/ibm-plex-serif/600.css";
import "@fontsource/ibm-plex-sans-thai-looped/400.css";
import "@fontsource/ibm-plex-sans-thai-looped/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: { default: "Gen AI — Study Assistant", template: "%s · Gen AI" },
  description: "An AI study assistant that learns from your own course materials, powered by a local Ollama model.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
