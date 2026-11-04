/**
 * GET  /api/admin/tenants  — list (super-admin only)
 * POST /api/admin/tenants  — create a new tenant (super-admin only)
 *
 * Provisioning a tenant:
 *   1. Validate input (zod)
 *   2. Allocate a unique slug
 *   3. Find or create the Firebase user for the proposed owner email.
 *      For new users, create with a randomly-generated temp password —
 *      the owner will sign in via magic link and reset.
 *   4. Set tenant_id + role=tenant_owner custom claims on that user
 *   5. Create the tenant doc with subscription defaults
 *   6. Audit
 */

import { EMAIL_FROM } from "@/lib/email";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth-server";
import { db } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import {
  provisionTenantForOwner,
  generateTenantOwnerSignInLink,
} from "@/lib/tenant";
import type { CompanyType, TenantSubscriptionTier } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum([
    "med_spa",
    "aesthetic_clinic",
    "iv_lounge",
    "wellness_studio",
    "lash_brow_studio",
    "head_spa",
    "other",
    "unknown",
  ]),
  owner_email: z.string().trim().toLowerCase().email(),
  owner_full_name: z.string().trim().min(1).max(120),
  subscription_tier: z.enum(["founding_25", "basic", "growth", "enterprise"]).default("founding_25"),
  timezone: z.string().trim().default("America/Denver"),
  trial_days: z.number().int().min(0).max(60).default(14),
});

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Create.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // 1. Provision (idempotent on owner_email)
  let result: Awaited<ReturnType<typeof provisionTenantForOwner>>;
  try {
    result = await provisionTenantForOwner({
      clinicName: data.name,
      clinicType: data.type as CompanyType,
      ownerEmail: data.owner_email,
      ownerFullName: data.owner_full_name,
      subscriptionTier: data.subscription_tier as TenantSubscriptionTier,
      timezone: data.timezone,
      trialDays: data.trial_days,
    });
  } catch (err) {
    console.error("[tenants-post] provision failed", err);
    return NextResponse.json({ error: "Could not create tenant." }, { status: 500 });
  }

  // 2. Audit
  try {
    await writeAudit({
      action: "admin.user_create",
      actorEmail: session.email,
      actorUserId: session.firebaseUid,
      targetType: "tenant",
      targetId: result.slug,
      after: {
        name: data.name,
        owner_email: data.owner_email,
        owner_uid: result.ownerUid,
        tier: data.subscription_tier,
        already_existed: result.alreadyExisted,
      },
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: req.headers.get("user-agent") || null,
    });
  } catch (err) {
    console.error("[tenants-post] audit", err);
  }

  // 3. Send invite email (best-effort)
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;
    const link = await generateTenantOwnerSignInLink(data.owner_email, baseUrl);
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: EMAIL_FROM.support,
          to: [data.owner_email],
          subject: `Welcome to Aesthera — sign in to ${data.name}`,
          html: `
            <p>Your clinic <strong>${data.name}</strong> has been provisioned on Aesthera.</p>
            <p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:8px;font-weight:600;">Sign in →</a></p>
            <p style="font-size:12px;color:#888;">Link expires in 15 minutes.</p>
          `,
        }),
      });
    } else {
      console.log("[tenants-post] (no resend key) invite link for", data.owner_email, "→", link);
    }
  } catch (err) {
    console.error("[tenants-post] invite send", err);
  }

  return NextResponse.json({
    ok: true,
    slug: result.slug,
    ownerUid: result.ownerUid,
    alreadyExisted: result.alreadyExisted,
  });
}
