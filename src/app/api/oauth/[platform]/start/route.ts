/**
 * GET /api/oauth/[platform]/start
 *
 * Owner-initiated. Generates a signed state token and redirects to the
 * platform's authorize URL. Callback returns to /api/oauth/[platform]/callback.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { signState, platformConfig } from "@/lib/oauth";
import { tenantCol } from "@/lib/tenant";
import { checkResourceLimit } from "@/lib/tier-limits";
import type { SocialConnectionDoc, SocialPlatform } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PlatformSchema = z.enum(["meta", "x", "google_ads", "youtube", "tiktok"]);

export async function GET(
  req: Request,
  rctx: { params: Promise<{ platform: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { platform: platformParam } = await rctx.params;
  const parsed = PlatformSchema.safeParse(platformParam);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown platform." }, { status: 400 });
  }
  const platform = parsed.data as SocialPlatform;
  const cfg = platformConfig(platform);
  if (!cfg.configured) {
    return NextResponse.json(
      { error: `${platform} OAuth client is not configured. ${cfg.setupHint}` },
      { status: 503 },
    );
  }

  // Tier channel limit — count current connected channels (excluding the one
  // being reconnected). Email always counts as included for the clinic; we
  // cap connected non-email integrations.
  const existingSnap = await tenantCol(ctx.tenant.id, "social_connections")
    .where("status", "==", "connected")
    .get()
    .catch(() => null);
  const currentChannels =
    existingSnap?.docs.filter((d) => d.id !== platform && (d.data() as SocialConnectionDoc).status === "connected").length ?? 0;
  const limit = checkResourceLimit({
    tier: ctx.tenant.subscription_tier,
    field: "max_marketing_channels",
    current: currentChannels,
  });
  if (!limit.ok) {
    // Returning JSON is fine — the popup callback page surfaces it.
    return NextResponse.json(
      { error: limit.message, upgrade_to: limit.upgrade_to },
      { status: 402 },
    );
  }

  // For google_ads + youtube the callback path is the same (/api/oauth/google/callback)
  // because they share an OAuth client. We carry the actual chosen platform in state.
  const callbackPlatform = platform === "youtube" || platform === "google_ads" ? "google" : platform;
  const redirectUri = `${getOrigin(req)}/api/oauth/${callbackPlatform}/callback`;
  const state = signState({
    tenantId: ctx.tenant.id,
    platform,
    actorUid: ctx.user.firebaseUid,
  });

  return NextResponse.redirect(cfg.authorizeUrl(state, redirectUri, cfg.defaultScopes), {
    status: 302,
  });
}

function getOrigin(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}
