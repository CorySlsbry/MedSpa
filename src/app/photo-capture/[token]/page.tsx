import type { Metadata } from "next";
import PhotoCaptureClient from "./PhotoCaptureClient";

export const metadata: Metadata = {
  title: "Photo capture",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Public photo-capture landing page hit by the QR code on the desktop
 * chart. Token is passed in the URL; PhotoCaptureClient validates +
 * uses it for token-auth uploads via /api/photos/pair-upload.
 *
 * No tenant session required — the token IS the auth, scoped to a
 * single (client, appointment, chart) tuple with a 30-minute TTL.
 */
export default async function PhotoCapturePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PhotoCaptureClient token={token} />;
}
