/**
 * POST /api/admin/auth/mfa-session-finalize
 *
 * Receives an ID token that the Firebase client SDK obtained AFTER an MFA
 * challenge completed (TOTP or SMS). We verify the token, extract the
 * second-factor claim, mint a session cookie carrying AAL2.
 *
 * Used when sign-in completes client-side via the firebase SDK (typically
 * the SMS challenge path). The TOTP-only path can use the server-side
 * /api/admin/auth/mfa-verify route instead.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  createSessionCookie,
  ensureUserRecord,
  isBootstrapAdminEmail,
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

const Body = z.object({
  idToken: z.string().min(20),
  next: z.string().trim().max(500).default("/admin"),
});

export async function POST(req: Request) {
  init();
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Missing idToken." }, { status: 400 });
  }
  const { idToken, next } = parsed.data;
  const safeNext = next.startsWith("/admin") ? next : "/admin";
  const ip = getIp(req);
  const ua = req.headers.get("user-agent") || null;

  // Verify the idToken (with revocation check)
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(idToken, true);
  } catch (err) {
    console.error("[mfa-session-finalize] verifyIdToken failed", err);
    return NextResponse.json(
      { ok: false, error: "Sign-in token is invalid or expired." },
      { status: 401 },
    );
  }

  const email = (decoded.email || "").toLowerCase();
  const uid = decoded.uid;

  if (!isBootstrapAdminEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "This account is not authorized." },
      { status: 401 },
    );
  }

  const fb = (decoded as unknown as {
    firebase?: { sign_in_second_factor?: string };
  }).firebase;
  const aalHere = fb?.sign_in_second_factor ? "aal2" : "aal1";

  // Mint session cookie
  let sessionCookie: { value: string; maxAgeSeconds: number };
  try {
    sessionCookie = await createSessionCookie(idToken);
  } catch (err) {
    console.error("[mfa-session-finalize] createSessionCookie failed", err);
    return NextResponse.json(
      { ok: false, error: "Could not establish session." },
      { status: 500 },
    );
  }

  try {
    await ensureUserRecord({
      firebaseUid: uid,
      email,
      emailVerified: !!decoded.email_verified,
      displayName: (decoded.name as string) || null,
      role: "super_admin",
      isBootstrapAdmin: true,
    });
    await recordSuccessfulLogin(uid);
  } catch (err) {
    console.error("[mfa-session-finalize] ensureUser/reset", err);
  }

  try {
    await db().collection("login_attempts").add({
      email,
      firebase_uid: uid,
      succeeded: true,
      failure_reason: null,
      ip,
      user_agent: ua,
      created_at: now(),
    });
    await writeAudit({
      action: "login.success",
      actorEmail: email,
      actorUserId: uid,
      targetType: "session",
      after: {
        method: fb?.sign_in_second_factor || "primary",
        aal: aalHere,
        ttl_seconds: sessionCookie.maxAgeSeconds,
      },
      ip,
      userAgent: ua,
    });
  } catch (err) {
    console.error("[mfa-session-finalize] audit", err);
  }

  isUnseenIp(email, ip)
    .then((isNew) => {
      if (!isNew || !ip) return;
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
      return sendSecurityAlert(
        email,
        "New Aesthera CRM sign-in from a new location",
        newIpAlertHtml({ email, ip, ua, when: new Date(), signinUrl: baseUrl }),
      );
    })
    .catch((err) => console.error("[mfa-session-finalize] new-ip alert", err));

  const res = NextResponse.json({ ok: true, redirect: safeNext });
  res.cookies.set(SESSION_COOKIE_NAME, sessionCookie.value, {
    maxAge: sessionCookie.maxAgeSeconds,
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
