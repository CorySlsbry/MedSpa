/**
 * POST /api/billing/webhook
 *
 * Stripe webhook receiver. Verifies the signature with the webhook secret,
 * then syncs subscription lifecycle events to the TenantDoc.
 *
 * Events handled:
 *   - checkout.session.completed: link customer + subscription to tenant
 *   - customer.subscription.created / updated / deleted: sync status + tier
 *   - invoice.payment_failed: log + audit (dunning UI is Stripe-handled)
 *
 * Webhook URL: https://<host>/api/billing/webhook
 *   STRIPE_WEBHOOK_SECRET must be set (Cloud Run env or Secret Manager).
 *
 * NOTE: this is a public endpoint. Stripe signs the request body using
 * the secret and the request reaches our domain — there's no auth in the
 * traditional sense. The signature verification IS the auth.
 */

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db, now } from "@/lib/firestore";
import { stripe, isStripeConfigured, mapStripeStatus, tierFromPriceId } from "@/lib/stripe";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe not configured." }, { status: 503 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret missing." }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error("[stripe-webhook] sig verification failed", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        // Unknown event types are intentionally ignored — return 200 so
        // Stripe doesn't retry. Logged for visibility.
        console.log("[stripe-webhook] ignored event type", event.type);
    }
  } catch (err) {
    console.error("[stripe-webhook] handler error", event.type, err);
    return NextResponse.json({ error: "Handler error." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const tenantId =
    session.client_reference_id ||
    (session.metadata?.tenant_id as string | undefined) ||
    null;
  if (!tenantId) {
    console.warn("[stripe-webhook] checkout.completed missing tenant_id", session.id);
    return;
  }
  const tenantRef = db().collection("tenants").doc(tenantId);
  const snap = await tenantRef.get();
  if (!snap.exists) {
    console.warn("[stripe-webhook] checkout.completed unknown tenant", tenantId);
    return;
  }

  const update: Record<string, unknown> = {
    updated_at: now(),
  };
  if (typeof session.customer === "string") update.stripe_customer_id = session.customer;
  if (typeof session.subscription === "string") update.stripe_subscription_id = session.subscription;
  await tenantRef.update(update);

  await writeAudit({
    action: "admin.user_create",
    actorEmail: session.customer_details?.email ?? null,
    targetType: "billing.checkout_completed",
    targetId: session.id,
    after: { tenant_id: tenantId, customer: session.customer, subscription: session.subscription },
  });
}

async function handleSubscriptionUpsert(sub: Stripe.Subscription) {
  const tenantId = (sub.metadata?.tenant_id as string | undefined) || null;
  // Fallback: look up by stripe_customer_id if metadata missing
  let resolvedTenantId = tenantId;
  if (!resolvedTenantId && typeof sub.customer === "string") {
    const lookup = await db()
      .collection("tenants")
      .where("stripe_customer_id", "==", sub.customer)
      .limit(1)
      .get();
    if (!lookup.empty) resolvedTenantId = lookup.docs[0].id;
  }
  if (!resolvedTenantId) {
    console.warn("[stripe-webhook] subscription.upsert no tenant resolution", sub.id);
    return;
  }

  const priceId = sub.items.data[0]?.price.id;
  const tier = priceId ? tierFromPriceId(priceId) : null;
  const status = mapStripeStatus(sub.status);

  const update: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    subscription_status: status,
    updated_at: now(),
  };
  if (tier) update.subscription_tier = tier;

  await db().collection("tenants").doc(resolvedTenantId).update(update);

  await writeAudit({
    action: "admin.user_create",
    targetType: "billing.subscription_synced",
    targetId: sub.id,
    after: { tenant_id: resolvedTenantId, status, tier, stripe_status: sub.status, price_id: priceId },
  });
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  let tenantId = (sub.metadata?.tenant_id as string | undefined) || null;
  if (!tenantId && typeof sub.customer === "string") {
    const lookup = await db()
      .collection("tenants")
      .where("stripe_customer_id", "==", sub.customer)
      .limit(1)
      .get();
    if (!lookup.empty) tenantId = lookup.docs[0].id;
  }
  if (!tenantId) return;

  await db()
    .collection("tenants")
    .doc(tenantId)
    .update({
      subscription_status: "cancelled",
      updated_at: now(),
    });

  await writeAudit({
    action: "admin.user_suspend",
    targetType: "billing.subscription_cancelled",
    targetId: sub.id,
    after: { tenant_id: tenantId, stripe_status: sub.status },
  });
}

async function handlePaymentFailed(inv: Stripe.Invoice) {
  let tenantId: string | null = null;
  if (typeof inv.customer === "string") {
    const lookup = await db()
      .collection("tenants")
      .where("stripe_customer_id", "==", inv.customer)
      .limit(1)
      .get();
    if (!lookup.empty) tenantId = lookup.docs[0].id;
  }
  await writeAudit({
    action: "admin.user_create",
    targetType: "billing.payment_failed",
    targetId: inv.id ?? null,
    after: {
      tenant_id: tenantId,
      amount_due: inv.amount_due,
      attempt_count: inv.attempt_count,
      next_payment_attempt: inv.next_payment_attempt,
    },
  });
}
