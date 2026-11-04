/**
 * POST /api/auth/start  — tenant-user magic link initiation.
 *
 * Mirrors /api/admin/auth/start but allows ANY user with a recognized
 * tenant role custom claim to receive a sign-in link. The continueUrl
 * lands on /api/auth/callback which handles role-aware redirect.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "firebase-admin/auth";
import { EMAIL_FROM } from "@/lib/email";
import {
  getApps,
  initializeApp,
  applicationDefault,
  cert,
} from "firebase-admin/app";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";

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
});

const PER_IP = { capacity: 5, windowMs: 60 * 60 * 1000 };
const PER_EMAIL = { capacity: 3, windowMs: 60 * 60 * 1000 };

export async function POST(req: Request) {
  init();
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ ok: true });
  const { email } = parsed.data;
  const ip = getIp(req);
  const ua = req.headers.get("user-agent") || null;

  const ipResult = ip ? checkRateLimit(`tenant-auth-start:ip:${ip}`, PER_IP) : ({ allowed: true } as const);
  const emailResult = checkRateLimit(`tenant-auth-start:email:${email}`, PER_EMAIL);
  if (!ipResult.allowed || !emailResult.allowed) {
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  }

  // Allowlist: user exists in Firebase AND has a recognized role claim
  let allowed = false;
  let uid: string | null = null;
  try {
    const u = await getAuth().getUserByEmail(email);
    uid = u.uid;
    const role = ((u.customClaims ?? {}) as { role?: string }).role;
    allowed = role === "tenant_owner" || role === "tenant_provider" || role === "tenant_client";
  } catch {
    /* user not found is treated as not-allowed */
  }

  // Always audit + always return ok (no enumeration leak)
  try {
    await db().collection("login_attempts").add({
      email,
      firebase_uid: uid,
      succeeded: false,
      failure_reason: allowed ? "link_sent" : "no_tenant_user",
      ip,
      user_agent: ua,
      created_at: now(),
    });
    await writeAudit({
      action: "login.failure",
      actorEmail: email,
      actorUserId: uid,
      targetType: "auth_attempt",
      after: { reason: allowed ? "link_sent" : "no_tenant_user", channel: "tenant_magic_link" },
      ip,
      userAgent: ua,
    });
  } catch (err) {
    console.error("[tenant-auth-start] audit", err);
  }

  if (!allowed) return NextResponse.json({ ok: true });

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;

  let link: string;
  try {
    link = await getAuth().generateSignInWithEmailLink(email, {
      url: `${baseUrl}/api/auth/callback?email=${encodeURIComponent(email)}`,
      handleCodeInApp: true,
    });
  } catch (err) {
    console.error("[tenant-auth-start] generateSignInWithEmailLink", err);
    return NextResponse.json({ ok: true });
  }

  await sendSignInEmail(email, link).catch((err) => {
    console.error("[tenant-auth-start] resend", err);
  });

  return NextResponse.json({ ok: true });
}

async function sendSignInEmail(email: string, link: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[tenant-auth-start] (no resend key) link for", email, "→", link);
    return;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.default,
      to: [email],
      subject: "Your Aesthera sign-in link",
      html: `
        <p>Click below to sign in to Aesthera.</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:8px;font-weight:600;">Sign in →</a></p>
        <p style="font-size:12px;color:#888;">
          This link expires in 15 minutes and can only be used once. If you
          didn't request it, you can ignore this email.
        </p>
      `,
    }),
  });
  if (!r.ok) console.error("[tenant-auth-start] resend status", r.status, await r.text());
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
