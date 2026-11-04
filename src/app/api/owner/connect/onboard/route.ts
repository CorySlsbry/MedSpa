/**
 * POST /api/owner/connect/onboard
 *
 * Creates a Stripe Connect Express account for the tenant if one
 * doesn't exist, then issues an Account Link for KYC onboarding.
 * Returns { url } — the owner navigates there to complete KYC.
 *
 * Idempotent: if the tenant already has a Connect account, just
 * issues a fresh onboarding link (Stripe links expire ~5 min after
 * issuance, so we always mint fresh).
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import {
  createConnectAccount,
  createOnboardingLink,
  isStripeConfigured,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured on this server." },
      { status: 503 },
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;

  const tenantRef = db().collection("tenants").doc(ctx.tenant.id);

  try {
    let accountId = ctx.tenant.stripe_connect_account_id;
    let isNew = false;

    if (!accountId) {
      accountId = await createConnectAccount({
        tenantSlug: ctx.tenant.id,
        ownerEmail: ctx.tenant.owner_email,
        tenantName: ctx.tenant.name,
      });
      await tenantRef.update({
        stripe_connect_account_id: accountId,
        updated_at: now(),
      });
      isNew = true;
    }

    const url = await createOnboardingLink({
      accountId,
      refreshUrl: `${baseUrl}/owner/billing?connect=refresh`,
      returnUrl: `${baseUrl}/owner/billing?connect=return`,
    });

    if (isNew) {
      await writeAudit({
        action: "connect.onboard_start",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "tenant",
        targetId: ctx.tenant.id,
        after: { stripe_connect_account_id: accountId },
        ip,
        userAgent: ua,
      });
    }

    return NextResponse.json({ ok: true, url, account_id: accountId });
  } catch (err) {
    console.error("[connect-onboard]", err);
    return NextResponse.json(
      { error: "Could not start Stripe Connect onboarding." },
      { status: 500 },
    );
  }
}
