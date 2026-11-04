import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://medspa-platform.run.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Aesthera · MedSpa Management Software for Med Spas & Wellness Studios",
    template: "%s — Aesthera",
  },
  description:
    "Aesthera is MedSpa management software that replaces seven disconnected tools. Booking, charting, owner financials, and AI marketing — across every location. Built for med spas, aesthetic clinics, IV lounges, and wellness studios.",
  applicationName: "Aesthera",
  authors: [{ name: "Aesthera" }],
  creator: "Aesthera",
  publisher: "Aesthera",
  keywords: [
    "Aesthera",
    "med spa management software",
    "med spa software",
    "med spa CRM",
    "aesthetic clinic software",
    "wellness studio software",
    "IV therapy software",
    "med spa charting",
    "SOAP notes med spa",
    "med spa marketing automation",
    "AI treatment plans",
    "multi-location med spa management",
    "HIPAA-ready med spa platform",
  ],
  openGraph: {
    type: "website",
    siteName: "Aesthera",
    title: "Aesthera · MedSpa Management Software",
    description:
      "Aesthera is MedSpa management software that replaces seven disconnected tools. Client records, provider charting, owner dashboards, AI marketing — across every location.",
    url: SITE_URL,
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
  alternates: { canonical: SITE_URL },
};

export const viewport: Viewport = {
  themeColor: "#1b2636",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
