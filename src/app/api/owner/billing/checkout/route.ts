/**
 * POST /api/owner/billing/checkout
 *
 * Creates a Stripe Checkout Session for the requesting tenant + tier.
 * Owner-only. Returns a redirect URL the client navigates to.
 *
 * If the tenant already has a Stripe customer, it's reused — otherwise
 * a new Stripe customer is created and stored on the TenantDoc.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db, now } from "@/lib/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { writeAudit } from "@/lib/audit";
import { stripe, isStripeConfigured, getPriceIdForTier } from "@/lib/stripe";
import type { TenantSubscriptionTier } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tier: z.enum(["founding_25", "basic", "growth", "enterprise"]),
});

export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured yet." },
      { status: 503 },
    );
  }

  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const tier = parsed.data.tier as TenantSubscriptionTier;
  const priceId = getPriceIdForTier(tier);
  if (!priceId) {
    return NextResponse.json(
      { error: `Pricing for ${tier} is not configured.` },
      { status: 503 },
    );
  }

  const s = stripe();
  const tenant = ctx.tenant;
  let customerId = tenant.stripe_customer_id;

  if (!customerId) {
    const customer = await s.customers.create({
      email: tenant.owner_email,
      name: tenant.name,
      metadata: { tenant_id: tenant.id, owner_user_id: tenant.owner_user_id },
    });
    customerId = customer.id;
    await db().collection("tenants").doc(tenant.id).update({
      stripe_customer_id: customerId,
      updated_at: now(),
    });
  }

  const origin = getOrigin(req);
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: { tenant_id: tenant.id, tier },
    },
    success_url: `${origin}/owner/billing?status=success&session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/owner/billing?status=cancel`,
    allow_promotion_codes: true,
    client_reference_id: tenant.id,
    metadata: { tenant_id: tenant.id, tier },
  });

  await writeAudit({
    action: "admin.user_create",
    actorUserId: ctx.user.firebaseUid,
    actorEmail: ctx.user.email,
    targetType: "billing.checkout_session",
    targetId: session.id,
    after: { tenant_id: tenant.id, tier, stripe_customer_id: customerId },
  }).catch((err) => console.error("[billing-checkout] audit", err));

  return NextResponse.json({ ok: true, url: session.url });
}

function getOrigin(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}
