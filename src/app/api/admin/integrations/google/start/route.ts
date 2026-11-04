/**
 * GET /api/admin/integrations/google/start
 *
 * Super-admin only. Builds the Google OAuth URL with Calendar + Gmail
 * scopes and redirects the browser to Google's consent screen.
 */

import { NextResponse } from "next/server";
import { getSessionUser, publicBaseUrl } from "@/lib/auth-server";
import { newOAuthClient, GOOGLE_ADMIN_SCOPES } from "@/lib/admin-google";
import { signState } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "super_admin") {
    return NextResponse.redirect(new URL("/admin/login?reason=not_admin", publicBaseUrl(req)));
  }

  const oauth = newOAuthClient();
  const state = signState({
    tenantId: "_platform_admin",
    // The SocialPlatform enum is tenant-scoped; we reuse the same signed-state
    // primitive for the admin Google flow with a sentinel platform value.
    platform: "google" as unknown as Parameters<typeof signState>[0]["platform"],
    actorUid: user.firebaseUid,
  });
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",  // Force re-consent so we always get a refresh token
    scope: GOOGLE_ADMIN_SCOPES,
    state,
    include_granted_scopes: true,
  });
  return NextResponse.redirect(url);
}
