/**
 * GET /api/owner/social/connections
 *
 * Returns this tenant's social/ad-platform connection state for the
 * Settings UI. NEVER returns the encrypted tokens or refresh tokens —
 * only public metadata + status.
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { platformConfig, PLATFORM_DISPLAY } from "@/lib/oauth";
import type { SocialConnectionDoc, SocialPlatform } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORMS: SocialPlatform[] = ["meta", "x", "google_ads", "youtube", "tiktok"];

export async function GET() {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const snap = await tenantCol(ctx.tenant.id, "social_connections").get().catch(() => null);
  const byPlatform = new Map<string, SocialConnectionDoc>();
  if (snap) {
    for (const d of snap.docs) {
      byPlatform.set(d.id, d.data() as SocialConnectionDoc);
    }
  }

  const out = PLATFORMS.map((platform) => {
    const conn = byPlatform.get(platform);
    const cfg = platformConfig(platform);
    return {
      platform,
      display: PLATFORM_DISPLAY[platform],
      configured: cfg.configured,
      setup_hint: cfg.setupHint,
      connection: conn
        ? {
            status: conn.status,
            account_handle: conn.account_handle,
            account_display_name: conn.account_display_name,
            scopes: conn.scopes,
            connected_by_email: conn.connected_by_email,
            last_used_at:
              conn.last_used_at instanceof Timestamp ? conn.last_used_at.toDate().toISOString() : null,
            last_error: conn.last_error,
            updated_at:
              conn.updated_at instanceof Timestamp ? conn.updated_at.toDate().toISOString() : null,
          }
        : null,
    };
  });

  return NextResponse.json({ ok: true, connections: out });
}
