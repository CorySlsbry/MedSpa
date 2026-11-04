/**
 * GET /api/admin/integrations/google/callback
 *
 * Google redirects here after the consent screen. We:
 *   1. Verify the signed state
 *   2. Exchange the code for tokens
 *   3. Pull the user's profile to capture account_email
 *   4. Encrypt + persist to platform_oauth/google
 *   5. Redirect back to /admin/integrations
 */

import { NextResponse } from "next/server";
import { google } from "googleapis";
import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { getSessionUser, publicBaseUrl } from "@/lib/auth-server";
import { newOAuthClient, GOOGLE_ADMIN_SCOPES, ADMIN_GOOGLE_DOC } from "@/lib/admin-google";
import { encryptToken, verifyState } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "super_admin") {
    return NextResponse.redirect(new URL("/admin/login?reason=not_admin", publicBaseUrl(req)));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const errParam = url.searchParams.get("error");

  if (errParam) {
    return NextResponse.redirect(
      new URL(`/admin/integrations?google_err=${encodeURIComponent(errParam)}`, publicBaseUrl(req)),
    );
  }
  if (!code || !stateRaw) {
    return NextResponse.redirect(new URL("/admin/integrations?google_err=missing_code", publicBaseUrl(req)));
  }

  let state;
  try {
    state = verifyState(stateRaw);
  } catch {
    return NextResponse.redirect(new URL("/admin/integrations?google_err=bad_state", publicBaseUrl(req)));
  }
  if (state.tenantId !== "_platform_admin" || (state.platform as string) !== "google") {
    return NextResponse.redirect(new URL("/admin/integrations?google_err=state_mismatch", publicBaseUrl(req)));
  }
  if (state.actorUid !== user.firebaseUid) {
    return NextResponse.redirect(new URL("/admin/integrations?google_err=actor_mismatch", publicBaseUrl(req)));
  }

  const oauth = newOAuthClient();
  let tokens;
  try {
    const result = await oauth.getToken(code);
    tokens = result.tokens;
  } catch (err) {
    console.error("[admin-google] token exchange failed", err);
    return NextResponse.redirect(new URL("/admin/integrations?google_err=token_exchange", publicBaseUrl(req)));
  }
  if (!tokens.access_token) {
    return NextResponse.redirect(new URL("/admin/integrations?google_err=no_access_token", publicBaseUrl(req)));
  }
  oauth.setCredentials(tokens);

  let profileEmail = user.email;
  let profileName: string | null = user.displayName;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: oauth });
    const me = await oauth2.userinfo.get();
    profileEmail = me.data.email ?? profileEmail;
    profileName = me.data.name ?? profileName;
  } catch (err) {
    console.warn("[admin-google] profile fetch failed; using session info", err);
  }

  const doc = {
    account_email: profileEmail,
    account_name: profileName,
    scopes: GOOGLE_ADMIN_SCOPES,
    access_token_enc: encryptToken(tokens.access_token),
    refresh_token_enc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
    expiry_at: tokens.expiry_date
      ? Timestamp.fromMillis(tokens.expiry_date)
      : Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
    connected_at: now(),
    updated_at: now(),
    last_used_at: null,
    last_error: null,
  };
  await db().doc(ADMIN_GOOGLE_DOC).set(doc);

  await writeAudit({
    action: "admin.user_create",
    actorEmail: user.email,
    actorUserId: user.firebaseUid,
    targetType: "platform_oauth.google",
    targetId: profileEmail,
    after: { account_email: profileEmail, scopes: GOOGLE_ADMIN_SCOPES },
  });

  return NextResponse.redirect(new URL("/admin/integrations?google=connected", publicBaseUrl(req)));
}
