/**
 * POST /api/admin/auth/password
 *
 * Direct sign-in via email + password. Used as a fallback to the magic-link
 * flow. Both auth paths converge on the same session-cookie endpoint.
 *
 * Path:
 *   1. Validate (zod), rate-limit per IP + per email.
 *   2. Allowlist gate — bail before talking to Identity Platform.
 *   3. POST to identitytoolkit.googleapis.com/v1/accounts:signInWithPassword
 *      using the public Web API key.
 *   4. Mint Firebase session cookie via Admin SDK.
 *   5. ensureUserRecord (Firestore users doc + super_admin custom claim).
 *   6. Audit + login_attempts.
 *   7. Set HttpOnly + Secure + SameSite=Lax cookie. Return JSON {ok,redirect}.
 *
 * Returns 200 even on bad credentials (with ok:false) to keep UX consistent
 * but DOES log the failure reason to audit. Rate limiting prevents brute force.
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
  checkLockout,
  recordFailedLogin,
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
import { getAuth } from "firebase-admin/auth";

function initFirebaseAdmin() {
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(200),
  next: z.string().trim().max(500).default("/admin"),
});

const PER_IP = { capacity: 10, windowMs: 60 * 60 * 1000 };
const PER_EMAIL = { capacity: 6, windowMs: 60 * 60 * 1000 };

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
  }

  const { email, password, next } = parsed.data;
  const ip = getIp(req);
  const ua = req.headers.get("user-agent") || null;
  const safeNext = next.startsWith("/admin") ? next : "/admin";

  // Rate limit
  const ipResult = ip ? checkRateLimit(`auth-pw:ip:${ip}`, PER_IP) : ({ allowed: true } as const);
  const emailResult = checkRateLimit(`auth-pw:email:${email}`, PER_EMAIL);
  if (!ipResult.allowed || !emailResult.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many sign-in attempts. Try again in an hour." },
      { status: 429 },
    );
  }

  // Allowlist gate
  if (!isBootstrapAdminEmail(email)) {
    await safeAudit(
      "login.failure",
      email,
      null,
      { reason: "not_on_allowlist", method: "password" },
      ip,
      ua,
    );
    return NextResponse.json(
      { ok: false, error: "Email or password is incorrect." },
      { status: 401 },
    );
  }

  // Lockout check — pull uid by email, then read user doc
  initFirebaseAdmin();
  let lockoutUid: string | null = null;
  try {
    const fbUser = await getAuth().getUserByEmail(email);
    lockoutUid = fbUser.uid;
    const lock = await checkLockout(fbUser.uid);
    if (lock.locked) {
      await safeAudit(
        "login.failure",
        email,
        fbUser.uid,
        { reason: "account_locked", until: lock.until.toISOString() },
        ip,
        ua,
      );
      return NextResponse.json(
        {
          ok: false,
          error: `Account is temporarily locked after too many failed attempts. Try again after ${lock.until.toLocaleTimeString()}.`,
        },
        { status: 423 },
      );
    }
  } catch (err) {
    // If user doesn't exist yet, the bootstrap admin auto-creates on first
    // signIn — let the flow continue.
    if ((err as { code?: string }).code !== "auth/user-not-found") {
      console.error("[admin-auth-password] lockout check error", err);
    }
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    console.error("[admin-auth-password] NEXT_PUBLIC_FIREBASE_API_KEY not set");
    return NextResponse.json(
      { ok: false, error: "Sign-in is not configured. Contact your admin." },
      { status: 500 },
    );
  }

  // Exchange email+password for ID token (or MFA challenge if enrolled)
  let idToken: string;
  let firebaseUid: string;
  let firebaseEmail: string;
  try {
    const restRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    if (!restRes.ok) {
      const text = await restRes.text();
      const reason = parseFirebaseError(text);
      // Bump the persistent failed-login counter
      let lockedUntil: Date | null = null;
      if (lockoutUid) {
        try {
          const r = await recordFailedLogin(lockoutUid);
          lockedUntil = r.lockedUntil;
        } catch (err) {
          console.error("[admin-auth-password] recordFailedLogin error", err);
        }
      }
      await safeAudit(
        "login.failure",
        email,
        lockoutUid,
        {
          reason,
          method: "password",
          status: restRes.status,
          locked_until: lockedUntil?.toISOString() ?? null,
        },
        ip,
        ua,
      );
      if (lockedUntil) {
        return NextResponse.json(
          {
            ok: false,
            error: `Too many failed attempts. Account locked until ${lockedUntil.toLocaleTimeString()}.`,
          },
          { status: 423 },
        );
      }
      return NextResponse.json(
        { ok: false, error: "Email or password is incorrect." },
        { status: 401 },
      );
    }
    const json = (await restRes.json()) as {
      idToken?: string;
      localId?: string;
      email?: string;
      mfaPendingCredential?: string;
      mfaInfo?: Array<{
        mfaEnrollmentId: string;
        displayName?: string;
        enrolledAt?: string;
        totpInfo?: Record<string, unknown>;
      }>;
    };

    // MFA branch: user has TOTP enrolled — return challenge, no session yet
    if (json.mfaPendingCredential && json.mfaInfo && json.mfaInfo.length > 0) {
      const totpFactor = json.mfaInfo.find((f) => f.totpInfo) ?? json.mfaInfo[0];
      await safeAudit(
        "login.success",
        email,
        null,
        { method: "password", step: "mfa_challenge_required" },
        ip,
        ua,
      );
      return NextResponse.json({
        ok: false,
        mfaRequired: true,
        mfaPendingCredential: json.mfaPendingCredential,
        mfaEnrollmentId: totpFactor.mfaEnrollmentId,
        mfaDisplayName: totpFactor.displayName ?? "Authenticator",
      });
    }

    if (!json.idToken || !json.localId || !json.email) {
      throw new Error("missing fields in REST response");
    }
    idToken = json.idToken;
    firebaseUid = json.localId;
    firebaseEmail = json.email.toLowerCase();
  } catch (err) {
    console.error("[admin-auth-password] exchange error", err);
    return NextResponse.json(
      { ok: false, error: "Sign-in failed. Try again." },
      { status: 500 },
    );
  }

  // Mint session cookie
  let session: { value: string; maxAgeSeconds: number };
  try {
    session = await createSessionCookie(idToken);
  } catch (err) {
    console.error("[admin-auth-password] createSessionCookie failed", err);
    return NextResponse.json(
      { ok: false, error: "Sign-in failed. Try again." },
      { status: 500 },
    );
  }

  // Ensure user record + reset failure counters
  try {
    await ensureUserRecord({
      firebaseUid,
      email: firebaseEmail,
      emailVerified: true,
      displayName: null,
      role: "super_admin",
      isBootstrapAdmin: true,
    });
    await recordSuccessfulLogin(firebaseUid);
  } catch (err) {
    console.error("[admin-auth-password] ensureUserRecord/reset error", err);
  }

  await safeAudit(
    "login.success",
    firebaseEmail,
    firebaseUid,
    { method: "password", ttl_seconds: session.maxAgeSeconds },
    ip,
    ua,
  );

  // New-IP detection — fire-and-forget alert email
  isUnseenIp(firebaseEmail, ip)
    .then((isNew) => {
      if (!isNew || !ip) return;
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
      return sendSecurityAlert(
        firebaseEmail,
        "New Aesthera CRM sign-in from a new location",
        newIpAlertHtml({
          email: firebaseEmail,
          ip,
          ua,
          when: new Date(),
          signinUrl: baseUrl,
        }),
      );
    })
    .catch((err) => console.error("[admin-auth-password] new-ip alert", err));

  const res = NextResponse.json({ ok: true, redirect: safeNext });
  res.cookies.set(SESSION_COOKIE_NAME, session.value, {
    maxAge: session.maxAgeSeconds,
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
    return "unparsable_response";
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
      failure_reason:
        action === "login.failure" ? String(details.reason ?? "") : null,
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
    console.error("[admin-auth-password] audit error", err);
  }
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
