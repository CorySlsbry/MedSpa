/**
 * POST /api/owner/connect/dashboard
 *
 * Mints a fresh single-use Login Link to the connected account's
 * Stripe Express dashboard. Owner manages payouts, bank accounts,
 * and disputes there — Stripe-hosted, no UI to maintain.
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { createLoginLink, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const accountId = ctx.tenant.stripe_connect_account_id;
  if (!accountId) {
    return NextResponse.json(
      { error: "Stripe Connect is not set up for this tenant yet." },
      { status: 400 },
    );
  }
  if (!ctx.tenant.stripe_connect_charges_enabled) {
    return NextResponse.json(
      { error: "Finish Stripe onboarding first." },
      { status: 400 },
    );
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe not configured." }, { status: 503 });
  }

  try {
    const url = await createLoginLink(accountId);
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    console.error("[connect-dashboard]", err);
    return NextResponse.json({ error: "Could not open Stripe dashboard." }, { status: 500 });
  }
}
