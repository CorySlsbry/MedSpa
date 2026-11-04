import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1b2636",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

/**
 * Embed layout. No marketing chrome — these pages are designed to be
 * dropped inside an iframe on a clinic's own website.
 */
export default function EmbedLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-white">{children}</div>;
}
