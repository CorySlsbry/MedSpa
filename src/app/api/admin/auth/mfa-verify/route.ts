/**
 * POST /api/admin/auth/mfa-verify
 *
 * MFA challenge during sign-in. If the password sign-in returned an
 * mfaPendingCredential (because the user has MFA enrolled), the client
 * POSTs here with the 6-digit TOTP code.
 *
 * On success: mints session cookie with AAL2.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionCookie,
  ensureUserRecord,
  isBootstrapAdminEmail,
  SESSION_COOKIE_NAME,
} from "@/lib/auth-server";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  recordSuccessfulLogin,
  isUnseenIp,
  sendSecurityAlert,
  newIpAlertHtml,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().trim().toLowerCase().email(),
  mfaPendingCredential: z.string().min(8),
  mfaEnrollmentId: z.string().min(8),
  verificationCode: z.string().regex(/^\d{6}$/, "Must be 6 digits."),
  next: z.string().trim().max(500).default("/admin"),
});

const RATE = { capacity: 8, windowMs: 60 * 60 * 1000 };

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const { email, mfaPendingCredential, mfaEnrollmentId, verificationCode, next } = parsed.data;
  const ip = getIp(req);
  const ua = req.headers.get("user-agent") || null;
  const safeNext = next.startsWith("/admin") ? next : "/admin";

  // Rate-limit MFA attempts per email — defense against TOTP brute force
  const rl = checkRateLimit(`mfa-verify:${email}`, RATE);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many code attempts. Wait an hour." },
      { status: 429 },
    );
  }

  if (!isBootstrapAdminEmail(email)) {
    await safeAudit("login.failure", email, null, { reason: "not_on_allowlist", method: "mfa" }, ip, ua);
    return NextResponse.json({ ok: false, error: "Code is incorrect." }, { status: 401 });
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Auth not configured." }, { status: 500 });
  }

  let idToken: string;
  let firebaseUid: string;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v2/accounts/mfaSignIn:finalize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mfaPendingCredential,
          totpVerificationInfo: { verificationCode },
        }),
      },
    );
    if (!r.ok) {
      const text = await r.text();
      const reason = parseFirebaseError(text);
      await safeAudit("login.failure", email, null, { reason, method: "mfa", status: r.status }, ip, ua);
      return NextResponse.json(
        { ok: false, error: "Code is incorrect or expired. Codes refresh every 30s." },
        { status: 401 },
      );
    }
    const j = (await r.json()) as { idToken?: string; localId?: string };
    if (!j.idToken || !j.localId) throw new Error("missing fields in finalize response");
    idToken = j.idToken;
    firebaseUid = j.localId;
  } catch (err) {
    console.error("[mfa-verify] error", err);
    return NextResponse.json({ ok: false, error: "Verification failed." }, { status: 500 });
  }

  let sessionCookie: { value: string; maxAgeSeconds: number };
  try {
    sessionCookie = await createSessionCookie(idToken);
  } catch (err) {
    console.error("[mfa-verify] session mint failed", err);
    return NextResponse.json({ ok: false, error: "Session refresh failed." }, { status: 500 });
  }

  try {
    await ensureUserRecord({
      firebaseUid,
      email,
      emailVerified: true,
      displayName: null,
      role: "super_admin",
      isBootstrapAdmin: true,
    });
    await recordSuccessfulLogin(firebaseUid);
  } catch (err) {
    console.error("[mfa-verify] ensureUserRecord/reset", err);
  }

  await safeAudit(
    "login.success",
    email,
    firebaseUid,
    { method: "password+mfa", aal: "aal2", mfa_enrollment_id: mfaEnrollmentId },
    ip,
    ua,
  );

  isUnseenIp(email, ip)
    .then((isNew) => {
      if (!isNew || !ip) return;
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
      return sendSecurityAlert(
        email,
        "New Aesthera CRM sign-in from a new location",
        newIpAlertHtml({
          email,
          ip,
          ua,
          when: new Date(),
          signinUrl: baseUrl,
        }),
      );
    })
    .catch((err) => console.error("[mfa-verify] new-ip alert", err));

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

function parseFirebaseError(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    return j?.error?.message ?? "unknown";
  } catch {
    return "unparsable";
  }
}

async function safeAudit(
  action: "login.success" | "login.failure",
  email: string,
  uid: string | null,
  details: Record<string, unknown>,
  ip: string | null,
  ua: string | null,
): Promise<void> {
  try {
    await db().collection("login_attempts").add({
      email,
      firebase_uid: uid,
      succeeded: action === "login.success",
      failure_reason: action === "login.failure" ? String(details.reason ?? "") : null,
      ip,
      user_agent: ua,
      created_at: now(),
    });
    await writeAudit({
      action,
      actorEmail: email,
      actorUserId: uid ?? null,
      targetType: "session",
      after: details,
      ip,
      userAgent: ua,
    });
  } catch (err) {
    console.error("[mfa-verify] audit error", err);
  }
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
