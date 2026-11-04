/**
 * GET /api/marketing/track/open?t=<tenantId>&c=<clientId>&cmp=<campaignId>
 *
 * Tracking pixel endpoint. Returns a 1x1 transparent GIF and updates
 * the most recent campaign_run for this (tenant, client, campaign) tuple
 * to opened_at = now() if it isn't already.
 *
 * Public (CORS-open) — that's the point of a tracking pixel.
 *
 * IMPORTANT: pixels can fire from email proxies (Gmail "image proxy")
 * which may artificially inflate opens. We accept that — open is a
 * weak signal anyway. Click tracking is the strong signal.
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { tenantCol } from "@/lib/tenant";
import type { CampaignRunDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("t");
  const clientId = url.searchParams.get("c");
  const campaignId = url.searchParams.get("cmp");

  // Always respond with the pixel — failures behind the scenes are silent
  if (tenantId && clientId) {
    void recordOpen(tenantId, clientId, campaignId).catch((err) =>
      console.error("[track-open]", err),
    );
  }

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function recordOpen(tenantId: string, clientId: string, campaignId: string | null): Promise<void> {
  // Find the most recent campaign_run that matches.
  const q = tenantCol(tenantId, "campaign_runs")
    .where("client_id", "==", clientId)
    .orderBy("created_at", "desc")
    .limit(5);
  const snap = await q.get().catch(() => null);
  if (!snap || snap.empty) return;

  // Pick the most recent matching campaign (or the most recent overall if no campaignId)
  const target = campaignId
    ? snap.docs.find((d) => (d.data() as CampaignRunDoc).campaign_id === campaignId)
    : snap.docs[0];
  if (!target) return;
  const data = target.data() as CampaignRunDoc;
  if (data.opened_at) return; // already recorded

  await target.ref.update({
    opened_at: Timestamp.now(),
    status: "opened",
  });
}
