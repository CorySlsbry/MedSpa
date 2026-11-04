/**
 * POST /api/auth/password
 *
 * Tenant-user password sign-in. Mirror of /api/admin/auth/password but the
 * allowlist gate is "user has a tenant role custom claim" instead of
 * "email is on the bootstrap admin allowlist."
 *
 * On success, returns { ok, redirect } with redirect set to the role-
 * appropriate portal (/owner, /provider, /client). Cookie is set HttpOnly.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionCookie,
  ensureUserRecord,
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
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(200),
});

const PER_IP = { capacity: 10, windowMs: 60 * 60 * 1000 };
const PER_EMAIL = { capacity: 6, windowMs: 60 * 60 * 1000 };

const ROLE_REDIRECT: Record<string, string> = {
  tenant_owner: "/owner",
  tenant_provider: "/provider",
  tenant_client: "/client",
  super_admin: "/admin",
};

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
    return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
  }
  const { email, password } = parsed.data;
  const ip = getIp(req);
  const ua = req.headers.get("user-agent") || null;

  const ipResult = ip ? checkRateLimit(`tenant-auth-pw:ip:${ip}`, PER_IP) : ({ allowed: true } as const);
  const emailResult = checkRateLimit(`tenant-auth-pw:email:${email}`, PER_EMAIL);
  if (!ipResult.allowed || !emailResult.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many sign-in attempts. Try again in an hour." },
      { status: 429 },
    );
  }

  // Look up the user; require a recognized role custom claim
  let fbUser;
  try {
    fbUser = await getAuth().getUserByEmail(email);
  } catch (err) {
    if ((err as { code?: string }).code === "auth/user-not-found") {
      await safeAudit("login.failure", email, null, { reason: "user_not_found" }, ip, ua);
      return NextResponse.json(
        { ok: false, error: "Email or password is incorrect." },
        { status: 401 },
      );
    }
    console.error("[tenant-auth-password] getUserByEmail", err);
    return NextResponse.json({ ok: false, error: "Sign-in failed." }, { status: 500 });
  }

  const claims = (fbUser.customClaims ?? {}) as { role?: string; tenant_id?: string };
  const role = claims.role;
  const tenantId = claims.tenant_id;
  if (!role || !ROLE_REDIRECT[role] || (role !== "super_admin" && !tenantId)) {
    await safeAudit("login.failure", email, fbUser.uid, { reason: "no_tenant_role" }, ip, ua);
    return NextResponse.json(
      { ok: false, error: "Email or password is incorrect." },
      { status: 401 },
    );
  }

  // Lockout
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
        error: `Account is temporarily locked. Try again after ${lock.until.toLocaleTimeString()}.`,
      },
      { status: 423 },
    );
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Auth not configured." }, { status: 500 });
  }

  // Sign in via REST
  let idToken: string;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    if (!r.ok) {
      const text = await r.text();
      const reason = parseFirebaseError(text);
      const fail = await recordFailedLogin(fbUser.uid).catch(() => null);
      await safeAudit("login.failure", email, fbUser.uid, { reason, locked: !!fail?.lockedUntil }, ip, ua);
      if (fail?.lockedUntil) {
        return NextResponse.json(
          {
            ok: false,
            error: `Too many failed attempts. Locked until ${fail.lockedUntil.toLocaleTimeString()}.`,
          },
          { status: 423 },
        );
      }
      return NextResponse.json(
        { ok: false, error: "Email or password is incorrect." },
        { status: 401 },
      );
    }
    const json = (await r.json()) as {
      idToken?: string;
      mfaPendingCredential?: string;
      mfaInfo?: Array<{ mfaEnrollmentId: string; displayName?: string; totpInfo?: unknown }>;
    };
    if (json.mfaPendingCredential && json.mfaInfo && json.mfaInfo.length > 0) {
      const totpFactor = json.mfaInfo.find((f) => f.totpInfo) ?? json.mfaInfo[0];
      return NextResponse.json({
        ok: false,
        mfaRequired: true,
        mfaPendingCredential: json.mfaPendingCredential,
        mfaEnrollmentId: totpFactor.mfaEnrollmentId,
        mfaDisplayName: totpFactor.displayName ?? "Authenticator",
      });
    }
    if (!json.idToken) throw new Error("missing idToken");
    idToken = json.idToken;
  } catch (err) {
    console.error("[tenant-auth-password] sign-in error", err);
    return NextResponse.json({ ok: false, error: "Sign-in failed." }, { status: 500 });
  }

  // Mint session cookie
  let session: { value: string; maxAgeSeconds: number };
  try {
    session = await createSessionCookie(idToken);
  } catch (err) {
    console.error("[tenant-auth-password] createSessionCookie", err);
    return NextResponse.json({ ok: false, error: "Sign-in failed." }, { status: 500 });
  }

  // Ensure record + reset failure counters
  try {
    await ensureUserRecord({
      firebaseUid: fbUser.uid,
      email,
      emailVerified: !!fbUser.emailVerified,
      displayName: fbUser.displayName ?? null,
      role: role as never,
      tenantId: tenantId ?? null,
      isBootstrapAdmin: false,
    });
    await recordSuccessfulLogin(fbUser.uid);
  } catch (err) {
    console.error("[tenant-auth-password] ensureUserRecord/reset", err);
  }

  await safeAudit("login.success", email, fbUser.uid, { method: "password", role, tenant_id: tenantId ?? null }, ip, ua);

  isUnseenIp(email, ip)
    .then((isNew) => {
      if (!isNew || !ip) return;
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
      return sendSecurityAlert(
        email,
        "New Aesthera sign-in from a new location",
        newIpAlertHtml({ email, ip, ua, when: new Date(), signinUrl: baseUrl }),
      );
    })
    .catch((err) => console.error("[tenant-auth-password] new-ip alert", err));

  const redirect = ROLE_REDIRECT[role];
  const res = NextResponse.json({ ok: true, redirect });
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
      actorUserId: uid,
      targetType: "session",
      after: details,
      ip,
      userAgent: ua,
    });
  } catch (err) {
    console.error("[tenant-auth-password] audit error", err);
  }
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
