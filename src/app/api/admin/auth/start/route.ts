/**
 * POST /api/admin/auth/start
 *
 * Initiate super-admin sign-in via magic link.
 *
 * Flow:
 *   1. Validate email format.
 *   2. Rate-limit per IP (5/hr) and per email (3/hr).
 *   3. If email is on the bootstrap allowlist, generate a sign-in link via
 *      Firebase Admin SDK and send it via Resend.
 *   4. ALWAYS return 200 with {ok:true} — no enumeration leak.
 *   5. Audit-log the attempt regardless.
 */

import { NextResponse } from "next/server";
import { EMAIL_FROM } from "@/lib/email";
import { z } from "zod";
import { getAuth } from "firebase-admin/auth";
import {
  getApps,
  initializeApp,
  applicationDefault,
  cert,
} from "firebase-admin/app";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { isBootstrapAdminEmail } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function init() {
  if (getApps().length > 0) return;
  const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saB64) {
    try {
      const parsed = JSON.parse(Buffer.from(saB64, "base64").toString("utf8"));
      initializeApp({ credential: cert(parsed) });
      return;
    } catch {
      /* fallthrough */
    }
  }
  initializeApp({ credential: applicationDefault() });
}

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  next: z.string().trim().max(500).default("/admin"),
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
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }
  const { email, next } = parsed.data;
  const ip = getIp(req);
  const ua = req.headers.get("user-agent") || null;

  const ipResult = ip ? checkRateLimit(`auth-start:ip:${ip}`, PER_IP) : ({ allowed: true } as const);
  const emailResult = checkRateLimit(`auth-start:email:${email}`, PER_EMAIL);
  if (!ipResult.allowed || !emailResult.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429 },
    );
  }

  const isAllowed = isBootstrapAdminEmail(email);
  // Always audit the attempt — we want signal on enumeration probes too.
  try {
    await db().collection("login_attempts").add({
      email,
      firebase_uid: null,
      succeeded: false,
      failure_reason: isAllowed ? "link_sent" : "not_on_allowlist",
      ip,
      user_agent: ua,
      created_at: now(),
    });
    await writeAudit({
      action: "login.failure",
      actorEmail: email,
      targetType: "auth_attempt",
      targetId: email,
      after: { reason: isAllowed ? "link_sent" : "not_on_allowlist" },
      ip,
      userAgent: ua,
    });
  } catch (err) {
    console.error("[admin-auth-start] audit failure", err);
  }

  if (!isAllowed) {
    // Behave identically to success (no enumeration leak).
    return NextResponse.json({ ok: true });
  }

  // Generate the sign-in link via Identity Platform.
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;

  let link: string;
  try {
    link = await getAuth().generateSignInWithEmailLink(email, {
      url: `${baseUrl}/api/admin/auth/callback?next=${encodeURIComponent(next)}&email=${encodeURIComponent(email)}`,
      handleCodeInApp: true,
    });
  } catch (err) {
    console.error("[admin-auth-start] generateSignInWithEmailLink failed", err);
    return NextResponse.json({ ok: true });
  }

  await sendMagicLinkEmail(email, link).catch((err) => {
    console.error("[admin-auth-start] email send failed", err);
  });

  return NextResponse.json({ ok: true });
}

async function sendMagicLinkEmail(email: string, link: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[admin-auth-start] (no resend key) link for", email, "→", link);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM.admin,
      to: [email],
      subject: "Aesthera CRM — your sign-in link",
      html: `
        <p>Click the link below to sign in to Aesthera CRM.</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:8px;font-weight:600;">Sign in →</a></p>
        <p style="font-size:12px;color:#888;">
          This link expires in 15 minutes and can only be used once.
          If you didn't request it, you can ignore this email — your account is safe.
        </p>
      `,
    }),
  });
  if (!res.ok) {
    console.error("[admin-auth-start] resend status", res.status, await res.text());
  }
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
