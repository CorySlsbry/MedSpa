/**
 * POST /api/owner/client-memberships/[id]/setup-card
 *
 * Creates a Stripe Customer (if absent) on the connected account and
 * a SetupIntent for the customer to add a card. Returns the
 * client_secret + publishable key so the owner UI can render
 * Stripe Elements for card entry.
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { isStripeConfigured, stripe } from "@/lib/stripe";
import type { ClientDoc, ClientMembershipDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe not configured." }, { status: 503 });
  }
  if (!ctx.tenant.stripe_connect_account_id || !ctx.tenant.stripe_connect_charges_enabled) {
    return NextResponse.json(
      { error: "Finish Stripe Connect onboarding before collecting card-on-file." },
      { status: 400 },
    );
  }

  const { id } = await rctx.params;
  const ref = tenantCol(ctx.tenant.id, "client_memberships").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const m = snap.data() as ClientMembershipDoc;

  // Resolve client for receipt email + customer name
  const cliSnap = await tenantCol(ctx.tenant.id, "clients").doc(m.client_id).get();
  if (!cliSnap.exists) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }
  const client = cliSnap.data() as ClientDoc;

  try {
    // Find or create Stripe Customer on connected account
    let customerId = m.stripe_customer_id;
    if (!customerId) {
      const cust = await stripe().customers.create(
        {
          email: client.email,
          name: client.full_name,
          metadata: {
            aesthera_tenant_slug: ctx.tenant.id,
            aesthera_membership_id: id,
            aesthera_client_id: m.client_id,
          },
        },
        { stripeAccount: ctx.tenant.stripe_connect_account_id },
      );
      customerId = cust.id;
      await ref.update({ stripe_customer_id: customerId, updated_at: now() });
    }

    // Create a SetupIntent so the client can add a card without paying
    const setup = await stripe().setupIntents.create(
      {
        customer: customerId,
        usage: "off_session",
        automatic_payment_methods: { enabled: true },
        metadata: {
          aesthera_tenant_slug: ctx.tenant.id,
          aesthera_membership_id: id,
        },
      },
      { stripeAccount: ctx.tenant.stripe_connect_account_id },
    );

    return NextResponse.json({
      ok: true,
      client_secret: setup.client_secret,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
      stripe_account_id: ctx.tenant.stripe_connect_account_id,
    });
  } catch (err) {
    console.error("[setup-card]", err);
    return NextResponse.json({ error: "Could not start card setup." }, { status: 500 });
  }
}
