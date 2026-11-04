/**
 * GET /api/owner/connect/status
 *
 * Pulls the live Stripe account state and reconciles it onto the
 * TenantDoc (charges_enabled, payouts_enabled, details_submitted).
 * Used to refresh the /owner/billing UI after the owner returns from
 * Stripe-hosted onboarding.
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { db, now } from "@/lib/firestore";
import { fetchConnectStatus, isStripeConfigured } from "@/lib/stripe";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const accountId = ctx.tenant.stripe_connect_account_id;
  if (!accountId) {
    return NextResponse.json({
      ok: true,
      connected: false,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe not configured." }, { status: 503 });
  }

  try {
    const status = await fetchConnectStatus(accountId);
    const becameActive =
      status.charges_enabled && !ctx.tenant.stripe_connect_charges_enabled;

    await db().collection("tenants").doc(ctx.tenant.id).update({
      stripe_connect_charges_enabled: status.charges_enabled,
      stripe_connect_payouts_enabled: status.payouts_enabled,
      stripe_connect_details_submitted: status.details_submitted,
      updated_at: now(),
    });

    if (becameActive) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
      const ua = req.headers.get("user-agent") || null;
      await writeAudit({
        action: "connect.onboard_complete",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "tenant",
        targetId: ctx.tenant.id,
        after: status,
        ip,
        userAgent: ua,
      });
    }

    return NextResponse.json({
      ok: true,
      connected: true,
      account_id: accountId,
      ...status,
    });
  } catch (err) {
    console.error("[connect-status]", err);
    return NextResponse.json({ error: "Could not fetch Stripe status." }, { status: 500 });
  }
}
