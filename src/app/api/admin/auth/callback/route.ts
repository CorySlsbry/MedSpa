/**
 * GET /api/admin/auth/callback
 *
 * Magic-link landing page. Exchanges oobCode for an ID token, mints a
 * session cookie, ensures the user record + custom claim, redirects to /admin.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionCookie,
  ensureUserRecord,
  isBootstrapAdminEmail,
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  email: z.string().trim().toLowerCase().email(),
  oobCode: z.string().trim().min(10),
  next: z.string().trim().default("/admin"),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = Query.safeParse({
    email: url.searchParams.get("email") || "",
    oobCode: url.searchParams.get("oobCode") || "",
    next: url.searchParams.get("next") || "/admin",
  });

  if (!params.success) {
    return NextResponse.redirect(new URL("/admin/login?reason=expired", publicBaseUrl(req)));
  }

  // Open-redirect defense: only allow `next` inside /admin
  const safeNext = params.data.next.startsWith("/admin")
    ? params.data.next
    : "/admin";

  const ip = getIp(req);
  const ua = req.headers.get("user-agent") || null;

  if (!isBootstrapAdminEmail(params.data.email)) {
    await safeAudit({
      action: "login.failure",
      actorEmail: params.data.email,
      after: { reason: "not_on_allowlist_at_callback" },
      ip,
      userAgent: ua,
    });
    return NextResponse.redirect(new URL("/admin/login?reason=not_admin", publicBaseUrl(req)));
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    console.error("[admin-auth-callback] NEXT_PUBLIC_FIREBASE_API_KEY not set");
    return NextResponse.redirect(new URL("/admin/login?reason=expired", publicBaseUrl(req)));
  }

  let idToken: string;
  let firebaseEmail: string;
  let firebaseUid: string;
  try {
    const restRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: params.data.email,
          oobCode: params.data.oobCode,
        }),
      },
    );
    if (!restRes.ok) {
      const text = await restRes.text();
      console.error("[admin-auth-callback] signInWithEmailLink failed", restRes.status, text);
      await safeAudit({
        action: "login.failure",
        actorEmail: params.data.email,
        after: { reason: "rest_exchange_failed", status: restRes.status },
        ip,
        userAgent: ua,
      });
      return NextResponse.redirect(new URL("/admin/login?reason=expired", publicBaseUrl(req)));
    }
    const json = (await restRes.json()) as {
      idToken?: string;
      email?: string;
      localId?: string;
    };
    if (!json.idToken || !json.email || !json.localId) {
      throw new Error("missing fields in REST response");
    }
    idToken = json.idToken;
    firebaseEmail = json.email.toLowerCase();
    firebaseUid = json.localId;
  } catch (err) {
    console.error("[admin-auth-callback] exchange error", err);
    return NextResponse.redirect(new URL("/admin/login?reason=expired", publicBaseUrl(req)));
  }

  if (firebaseEmail !== params.data.email) {
    await safeAudit({
      action: "login.failure",
      actorEmail: firebaseEmail,
      after: { reason: "email_mismatch", url_email: params.data.email },
      ip,
      userAgent: ua,
    });
    return NextResponse.redirect(new URL("/admin/login?reason=not_admin", publicBaseUrl(req)));
  }

  let session: { value: string; maxAgeSeconds: number };
  try {
    session = await createSessionCookie(idToken);
  } catch (err) {
    console.error("[admin-auth-callback] createSessionCookie failed", err);
    return NextResponse.redirect(new URL("/admin/login?reason=expired", publicBaseUrl(req)));
  }

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
    console.error("[admin-auth-callback] ensureUserRecord/reset error", err);
  }

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
    .catch((err) => console.error("[admin-auth-callback] new-ip alert", err));

  await safeAudit({
    action: "login.success",
    actorEmail: firebaseEmail,
    actorUserId: firebaseUid,
    targetType: "session",
    after: { ttl_seconds: session.maxAgeSeconds },
    ip,
    userAgent: ua,
  });

  const res = NextResponse.redirect(new URL(safeNext, publicBaseUrl(req)));
  res.cookies.set(SESSION_COOKIE_NAME, session.value, {
    maxAge: session.maxAgeSeconds,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return res;
}

async function safeAudit(audit: {
  action: "login.success" | "login.failure";
  actorEmail: string;
  actorUserId?: string;
  targetType?: string;
  after: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  try {
    await db().collection("login_attempts").add({
      email: audit.actorEmail,
      firebase_uid: audit.actorUserId ?? null,
      succeeded: audit.action === "login.success",
      failure_reason:
        audit.action === "login.failure"
          ? String((audit.after as { reason?: string }).reason ?? "")
          : null,
      ip: audit.ip,
      user_agent: audit.userAgent,
      created_at: now(),
    });
    await writeAudit({
      action: audit.action,
      actorEmail: audit.actorEmail,
      actorUserId: audit.actorUserId ?? null,
      targetType: audit.targetType ?? "auth_attempt",
      after: audit.after,
      ip: audit.ip,
      userAgent: audit.userAgent,
    });
  } catch (err) {
    console.error("[admin-auth-callback] audit error", err);
  }
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
