/**
 * POST /api/admin/tenants/[id]/invite
 *
 * Send (or resend) a magic-link sign-in invitation to the tenant owner.
 * The link redirects to /owner on success.
 */

import { NextResponse } from "next/server";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getSessionUser } from "@/lib/auth-server";
import { getTenant } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { EMAIL_FROM } from "@/lib/email";

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

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { id } = await ctx.params;
  init();

  const tenant = await getTenant(id);
  if (!tenant) return NextResponse.json({ error: "Tenant not found." }, { status: 404 });

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;

  let link: string;
  try {
    link = await getAuth().generateSignInWithEmailLink(tenant.owner_email, {
      url: `${baseUrl}/api/auth/callback?email=${encodeURIComponent(tenant.owner_email)}`,
      handleCodeInApp: true,
    });
  } catch (err) {
    console.error("[tenant-invite] generateSignInWithEmailLink", err);
    return NextResponse.json({ error: "Could not generate link." }, { status: 500 });
  }

  await sendInviteEmail(tenant.owner_email, tenant.name, link).catch((err) => {
    console.error("[tenant-invite] resend", err);
  });

  try {
    await writeAudit({
      action: "admin.user_create",
      actorEmail: session.email,
      actorUserId: session.firebaseUid,
      targetType: "tenant_invite",
      targetId: tenant.id,
      after: { owner_email: tenant.owner_email, channel: "magic_link" },
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: req.headers.get("user-agent") || null,
    });
  } catch (err) {
    console.error("[tenant-invite] audit", err);
  }

  return NextResponse.json({ ok: true });
}

async function sendInviteEmail(email: string, tenantName: string, link: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[tenant-invite] (no resend key) link for", email, "→", link);
    return;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.support,
      to: [email],
      subject: `Welcome to Aesthera — sign in to ${tenantName}`,
      html: `
        <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px">
          <h2 style="color:#1b2636">Welcome to Aesthera</h2>
          <p>Your clinic <strong>${escapeHtml(tenantName)}</strong> has been
          provisioned on Aesthera. Click below to sign in for the first time.</p>
          <p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:8px;font-weight:600;">Sign in →</a></p>
          <p style="font-size:12px;color:#888;">
            This link expires in 15 minutes and can only be used once.
            If you didn't expect this email, you can ignore it.
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin-top:24px"/>
          <p style="font-size:12px;color:#888">
            Aesthera · MedSpa Management Software
          </p>
        </div>
      `,
    }),
  });
  if (!r.ok) console.error("[tenant-invite] resend status", r.status, await r.text());
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
