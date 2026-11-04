/**
 * POST /api/owner/billing/portal
 *
 * Generates a Stripe Customer Portal session for self-service: update
 * payment method, change plan, view invoices, cancel.
 *
 * Owner-only. Returns a redirect URL.
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { stripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured yet." },
      { status: 503 },
    );
  }

  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  if (!ctx.tenant.stripe_customer_id) {
    return NextResponse.json(
      { error: "No active subscription. Start one from /owner/billing." },
      { status: 409 },
    );
  }

  const origin = getOrigin(req);
  const session = await stripe().billingPortal.sessions.create({
    customer: ctx.tenant.stripe_customer_id,
    return_url: `${origin}/owner/billing`,
  });

  return NextResponse.json({ ok: true, url: session.url });
}

function getOrigin(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}
