/**
 * GET /api/auth/callback  — tenant-user magic link callback.
 *
 * Verifies the link, mints session, redirects to role-appropriate portal.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "firebase-admin/auth";
import {
  createSessionCookie,
  ensureUserRecord,
  publicBaseUrl,
  SESSION_COOKIE_NAME,
} from "@/lib/auth-server";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import {
  recordSuccessfulLogin,
  isUnseenIp,
  sendSecurityAlert,
  newIpAlertHtml,
} from "@/lib/security";
import {
  getApps,
  initializeApp,
  applicationDefault,
  cert,
} from "firebase-admin/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function init() {
  if (getApps().length > 0) return;
  const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saB64) {
    try {
      initializeApp({
        credential: cert(JSON.parse(Buffer.from(saB64, "base64").toString("utf8"))),
      });
      return;
    } catch {
      /* fallthrough */
    }
  }
  initializeApp({ credential: applicationDefault() });
}

const Query = z.object({
  email: z.string().trim().toLowerCase().email(),
  oobCode: z.string().trim().min(10),
});

const ROLE_REDIRECT: Record<string, string> = {
  tenant_owner: "/owner",
  tenant_manager: "/manager",
  tenant_provider: "/provider",
  tenant_front_desk: "/front-desk",
  tenant_client: "/client",
  super_admin: "/admin",
};

export async function GET(req: Request) {
  init();
  const url = new URL(req.url);
  const params = Query.safeParse({
    email: url.searchParams.get("email") || "",
    oobCode: url.searchParams.get("oobCode") || "",
  });
  if (!params.success) {
    return NextResponse.redirect(new URL("/sign-in?reason=expired", publicBaseUrl(req)));
  }

  const ip = getIp(req);
  const ua = req.headers.get("user-agent") || null;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    return NextResponse.redirect(new URL("/sign-in?reason=expired", publicBaseUrl(req)));
  }

  // Confirm user has a tenant role before exchanging
  let fbUser;
  try {
    fbUser = await getAuth().getUserByEmail(params.data.email);
  } catch {
    return NextResponse.redirect(new URL("/sign-in?reason=invalid", publicBaseUrl(req)));
  }
  const claims = (fbUser.customClaims ?? {}) as { role?: string; tenant_id?: string };
  const role = claims.role;
  // This endpoint is the TENANT auth callback. Super-admin sign-in must route
  // through /api/admin/auth/callback. If a super-admin email lands here (e.g.
  // they accidentally submitted the marketing demo form), redirect them to
  // the admin login page instead of letting them through the tenant flow.
  if (role === "super_admin") {
    return NextResponse.redirect(new URL("/admin/login?reason=use_admin_signin", publicBaseUrl(req)));
  }
  if (!role || role === "super_admin" || !ROLE_REDIRECT[role] || !claims.tenant_id) {
    return NextResponse.redirect(new URL("/sign-in?reason=invalid", publicBaseUrl(req)));
  }

  // Exchange oobCode for ID token
  let idToken: string;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: params.data.email, oobCode: params.data.oobCode }),
      },
    );
    if (!r.ok) {
      console.error("[tenant-auth-callback] exchange failed", r.status);
      return NextResponse.redirect(new URL("/sign-in?reason=expired", publicBaseUrl(req)));
    }
    const j = (await r.json()) as { idToken?: string };
    if (!j.idToken) throw new Error("missing idToken");
    idToken = j.idToken;
  } catch (err) {
    console.error("[tenant-auth-callback] exchange error", err);
    return NextResponse.redirect(new URL("/sign-in?reason=expired", publicBaseUrl(req)));
  }

  let session: { value: string; maxAgeSeconds: number };
  try {
    session = await createSessionCookie(idToken);
  } catch (err) {
    console.error("[tenant-auth-callback] session", err);
    return NextResponse.redirect(new URL("/sign-in?reason=expired", publicBaseUrl(req)));
  }

  try {
    await ensureUserRecord({
      firebaseUid: fbUser.uid,
      email: params.data.email,
      emailVerified: true,
      displayName: fbUser.displayName ?? null,
      role: role as never,
      tenantId: claims.tenant_id ?? null,
      isBootstrapAdmin: false,
    });
    await recordSuccessfulLogin(fbUser.uid);
    await db().collection("login_attempts").add({
      email: params.data.email,
      firebase_uid: fbUser.uid,
      succeeded: true,
      failure_reason: null,
      ip,
      user_agent: ua,
      created_at: now(),
    });
    await writeAudit({
      action: "login.success",
      actorEmail: params.data.email,
      actorUserId: fbUser.uid,
      targetType: "session",
      after: { method: "magic_link", role, tenant_id: claims.tenant_id ?? null },
      ip,
      userAgent: ua,
    });
  } catch (err) {
    console.error("[tenant-auth-callback] post-auth", err);
  }

  isUnseenIp(params.data.email, ip)
    .then((isNew) => {
      if (!isNew || !ip) return;
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
      return sendSecurityAlert(
        params.data.email,
        "New Aesthera sign-in from a new location",
        newIpAlertHtml({ email: params.data.email, ip, ua, when: new Date(), signinUrl: baseUrl }),
      );
    })
    .catch((err) => console.error("[tenant-auth-callback] alert", err));

  const redirect = ROLE_REDIRECT[role];
  const res = NextResponse.redirect(new URL(redirect, publicBaseUrl(req)));
  res.cookies.set(SESSION_COOKIE_NAME, session.value, {
    maxAge: session.maxAgeSeconds,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return res;
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
