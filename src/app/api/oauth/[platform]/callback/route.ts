/**
 * GET /api/oauth/[platform]/callback
 *
 * Where the OAuth provider returns after user consent. Verifies the
 * signed state, exchanges code → tokens, fetches user profile (for
 * display metadata), encrypts + persists.
 *
 * Path note: google_ads and youtube share /api/oauth/google/callback;
 * the actual platform is read from the signed state token.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { verifyState, platformConfig, encryptToken } from "@/lib/oauth";
import type { SocialConnectionDoc, SocialPlatform } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PathPlatform = z.enum(["meta", "x", "google", "tiktok"]);

export async function GET(
  req: Request,
  rctx: { params: Promise<{ platform: string }> },
) {
  const { platform: pathPlatform } = await rctx.params;
  const platformParse = PathPlatform.safeParse(pathPlatform);
  if (!platformParse.success) {
    return failPage("Unknown OAuth callback platform.");
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error") || url.searchParams.get("error_description");
  if (oauthError) return failPage(`OAuth error: ${oauthError}`);
  if (!code || !stateRaw) return failPage("Missing OAuth code or state.");

  let state;
  try {
    state = verifyState(stateRaw);
  } catch (err) {
    return failPage(`State invalid: ${(err as Error).message}`);
  }

  // Map back from path-platform to actual platform (carried in state)
  const actualPlatform = state.platform as SocialPlatform;

  const cfg = platformConfig(actualPlatform);
  if (!cfg.configured) {
    return failPage(`${actualPlatform} client is not configured server-side.`);
  }

  const callbackPlatform = pathPlatform; // google | meta | x | tiktok
  const redirectUri = `${getOrigin(req)}/api/oauth/${callbackPlatform}/callback`;

  let tokenResp: TokenResponse;
  try {
    tokenResp = await exchangeCode(actualPlatform, code, redirectUri);
  } catch (err) {
    return failPage(`Token exchange failed: ${(err as Error).message}`);
  }

  let profile: { id: string; handle: string | null; displayName: string | null };
  try {
    profile = await fetchProfile(actualPlatform, tokenResp.access_token);
  } catch (err) {
    console.error("[oauth-callback] profile fetch failed", err);
    profile = { id: "unknown", handle: null, displayName: null };
  }

  const docRef = tenantCol(state.tenantId, "social_connections").doc(actualPlatform);
  const expiresAt = tokenResp.expires_in
    ? Timestamp.fromMillis(Date.now() + tokenResp.expires_in * 1000)
    : null;

  const doc: Record<string, unknown> = {
    tenant_id: state.tenantId,
    platform: actualPlatform,
    status: "connected" satisfies SocialConnectionDoc["status"],
    account_id: profile.id,
    account_handle: profile.handle,
    account_display_name: profile.displayName,
    refresh_token_enc: tokenResp.refresh_token ? encryptToken(tokenResp.refresh_token) : null,
    access_token_enc: encryptToken(tokenResp.access_token),
    access_token_expires_at: expiresAt,
    scopes: cfg.defaultScopes,
    last_error: null,
    connected_by_user_id: state.actorUid,
    updated_at: now(),
    last_used_at: now(),
  };
  // Set created_at only on first connect.
  const existing = await docRef.get();
  if (!existing.exists) {
    doc.created_at = now();
  }

  await docRef.set(doc, { merge: true });

  await writeAudit({
    action: "admin.user_create",
    actorUserId: state.actorUid,
    targetType: "social_connection.connect",
    targetId: actualPlatform,
    after: {
      tenant_id: state.tenantId,
      platform: actualPlatform,
      account_handle: profile.handle,
      account_display_name: profile.displayName,
    },
  }).catch((err) => console.error("[oauth-callback] audit", err));

  return new NextResponse(successPage(actualPlatform), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

async function exchangeCode(
  platform: SocialPlatform,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  if (platform === "google_ads" || platform === "youtube") {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!res.ok) throw new Error(`google ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as TokenResponse;
  }
  if (platform === "meta") {
    const url = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
    url.searchParams.set("client_id", process.env.META_OAUTH_CLIENT_ID!);
    url.searchParams.set("client_secret", process.env.META_OAUTH_CLIENT_SECRET!);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code", code);
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) throw new Error(`meta ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as TokenResponse;
  }
  if (platform === "x") {
    const basic = Buffer.from(
      `${process.env.X_OAUTH_CLIENT_ID}:${process.env.X_OAUTH_CLIENT_SECRET}`,
    ).toString("base64");
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: "challenge",
      }).toString(),
    });
    if (!res.ok) throw new Error(`x ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as TokenResponse;
  }
  if (platform === "tiktok") {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_OAUTH_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_OAUTH_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!res.ok) throw new Error(`tiktok ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as TokenResponse;
  }
  throw new Error(`No token-exchange handler for ${platform}.`);
}

async function fetchProfile(
  platform: SocialPlatform,
  accessToken: string,
): Promise<{ id: string; handle: string | null; displayName: string | null }> {
  if (platform === "google_ads" || platform === "youtube") {
    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { id: "unknown", handle: null, displayName: null };
    const j = (await res.json()) as { sub?: string; email?: string; name?: string };
    return { id: j.sub ?? "unknown", handle: j.email ?? null, displayName: j.name ?? null };
  }
  if (platform === "meta") {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) return { id: "unknown", handle: null, displayName: null };
    const j = (await res.json()) as { id?: string; name?: string };
    return { id: j.id ?? "unknown", handle: null, displayName: j.name ?? null };
  }
  if (platform === "x") {
    const res = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { id: "unknown", handle: null, displayName: null };
    const j = (await res.json()) as { data?: { id?: string; username?: string; name?: string } };
    return {
      id: j.data?.id ?? "unknown",
      handle: j.data?.username ? `@${j.data.username}` : null,
      displayName: j.data?.name ?? null,
    };
  }
  if (platform === "tiktok") {
    const res = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return { id: "unknown", handle: null, displayName: null };
    const j = (await res.json()) as {
      data?: { user?: { open_id?: string; display_name?: string; username?: string } };
    };
    return {
      id: j.data?.user?.open_id ?? "unknown",
      handle: j.data?.user?.username ? `@${j.data.user.username}` : null,
      displayName: j.data?.user?.display_name ?? null,
    };
  }
  return { id: "unknown", handle: null, displayName: null };
}

function getOrigin(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

function successPage(platform: SocialPlatform): string {
  // postMessage the parent window (Marketing/Settings tab) so it can
  // refresh the ChannelsCard / IntegrationsView without a full reload.
  // If there's no opener (e.g. user navigated directly), fall back to
  // the old "Back to settings" UI.
  return `<!doctype html><html><head><title>Connected — Aesthera</title>
<meta name="robots" content="noindex">
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#1b2636}h1{font-size:22px}.card{background:#fdf8ef;border:1px solid #e6dfd0;border-radius:12px;padding:24px;margin-top:16px}a.btn{display:inline-block;background:#b98f42;color:#1b2636;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:16px}</style>
</head><body>
<h1>✓ ${escapeHtml(platform.replace(/_/g, " "))} connected</h1>
<div class="card">
<p>Your ${escapeHtml(platform.replace(/_/g, " "))} account is now linked.</p>
<p id="closing">This window will close automatically.</p>
<a class="btn" href="/owner/settings">Back to settings →</a>
</div>
<script>
(function(){
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: 'aesthera-oauth', platform: ${JSON.stringify(platform)}, success: true },
        window.location.origin
      );
      setTimeout(function(){ window.close(); }, 800);
    } else {
      var el = document.getElementById('closing');
      if (el) el.style.display = 'none';
    }
  } catch (e) { /* ignore */ }
})();
</script>
</body></html>`;
}

function failPage(message: string): NextResponse {
  const body = `<!doctype html><html><head><title>Connection failed — Aesthera</title>
<meta name="robots" content="noindex">
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#1b2636}h1{font-size:22px;color:#9b1c1c}.card{background:#fef2f2;border-left:4px solid #dc2626;padding:16px 24px;margin-top:16px}a.btn{display:inline-block;background:#1b2636;color:#fdf8ef;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:16px}</style>
</head><body>
<h1>Connection failed</h1>
<div class="card"><pre style="white-space:pre-wrap;margin:0;font-family:inherit">${escapeHtml(message)}</pre></div>
<a class="btn" href="/owner/settings">Back to settings →</a>
<script>
(function(){
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: 'aesthera-oauth', success: false, error: ${JSON.stringify(message)} },
        window.location.origin
      );
      setTimeout(function(){ window.close(); }, 1500);
    }
  } catch (e) { /* ignore */ }
})();
</script>
</body></html>`;
  return new NextResponse(body, {
    status: 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
