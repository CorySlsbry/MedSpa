/**
 * POST /api/billing/connect-webhook
 *
 * Receives Stripe events FROM connected accounts (Aesthera tenants).
 * Handles both event flavors:
 *
 *   V1 snapshot events (PaymentIntent / charge / account.updated for legacy V1 Express):
 *     - payment_intent.succeeded    → mark PaymentDoc.status=succeeded, capture receipt URL + card
 *     - payment_intent.payment_failed → status=failed, audit
 *     - payment_intent.amount_capturable_updated → status=requires_capture (deposit holds)
 *     - charge.refunded             → status=refunded / partially_refunded
 *     - account.updated             → reconcile tenant's connect flags (V1 Express)
 *
 *   V2 thin events (V2 accounts):
 *     - v2.core.account[requirements].updated         → re-pull status, update flags
 *     - v2.core.account[configuration.merchant].capability_status_updated
 *     - v2.core.account[configuration.customer].capability_status_updated
 *
 * Thin events arrive as a separate payload format; they're verified with
 * stripeClient.parseThinEvent() and the full payload fetched lazily via
 * stripeClient.v2.core.events.retrieve(thinEvent.id).
 *
 * Note: this is the CONNECT webhook (separate from /api/billing/webhook
 * which handles the platform's own subscription billing). Configure the
 * endpoint in Stripe Dashboard → Webhooks with "Connected accounts"
 * toggled on AND payload style "Thin" for v2.account.* events.
 */

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { tenantCol } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { stripe, isStripeConfigured, fetchConnectStatus } from "@/lib/stripe";
import { tenantByConnectAccount, mapStripePaymentStatus } from "@/lib/payments";
import { generateAndStoreReceipt } from "@/lib/receipts";
import { PLATFORM_NOREPLY_EMAIL } from "@/lib/email";
import type { ClientDoc, PaymentDoc, TenantDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe not configured." }, { status: 503 });
  }
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[connect-webhook] STRIPE_CONNECT_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook secret not configured." }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }
  const body = await req.text();
  const s = stripe();

  // Try V2 thin event first. parseEventNotification returns a discriminated
  // union with `type` (string) and `related_object?: {id, type, url}`.
  // If the body isn't a thin event, it throws — fall through to the V1 path.
  try {
    const note = s.parseEventNotification(body, sig, secret) as {
      id: string;
      type: string;
      related_object?: { id?: string | null; type?: string; url?: string } | null;
    };
    if (note?.type?.startsWith("v2.")) {
      return await handleThinEvent({
        id: note.id,
        type: note.type,
        related_object: note.related_object ?? undefined,
      });
    }
  } catch {
    // Not a thin event — fall through.
  }

  // V1 snapshot path
  let event: Stripe.Event;
  try {
    event = s.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error("[connect-webhook] signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Connect webhooks include the connected account ID
  const accountId = event.account;
  if (!accountId) {
    return NextResponse.json({ ok: true, ignored: "no account" });
  }

  const tenant = await tenantByConnectAccount(accountId);
  if (!tenant) {
    console.warn("[connect-webhook] no tenant for account", accountId, event.type);
    return NextResponse.json({ ok: true, ignored: "no tenant" });
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
      case "payment_intent.amount_capturable_updated":
      case "payment_intent.canceled":
      case "payment_intent.processing":
        await handlePaymentIntent(tenant, event.data.object as Stripe.PaymentIntent);
        break;
      case "charge.refunded":
        await handleChargeRefunded(tenant, event.data.object as Stripe.Charge);
        break;
      case "account.updated":
        await handleAccountUpdated(tenant, event.data.object as Stripe.Account);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error("[connect-webhook]", event.type, err);
    return NextResponse.json({ error: "Handler error." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Handle a V2 thin event for an Aesthera connected account.
 * Currently only `v2.core.account[*].updated` and capability_status_updated
 * shapes are wired — everything else acks 200.
 *
 * For requirement / capability changes we re-pull the full account state
 * via fetchConnectStatus() and reconcile onto the tenant doc, rather than
 * trying to apply diffs from the thin payload.
 */
async function handleThinEvent(thin: {
  id: string;
  type: string;
  related_object?: { id?: string | null } | null;
}): Promise<NextResponse> {
  const accountId = thin.related_object?.id ?? null;
  if (!accountId) {
    return NextResponse.json({ ok: true, ignored: "thin: no related_object.id", type: thin.type });
  }
  const tenant = await tenantByConnectAccount(accountId);
  if (!tenant) {
    console.warn("[connect-webhook] thin: no tenant for account", accountId, thin.type);
    return NextResponse.json({ ok: true, ignored: "thin: no tenant" });
  }

  const acted =
    thin.type === "v2.core.account[requirements].updated" ||
    thin.type.startsWith("v2.core.account[configuration.") ||
    thin.type.endsWith("capability_status_updated");
  if (!acted) {
    return NextResponse.json({ ok: true, ignored: thin.type });
  }

  try {
    const status = await fetchConnectStatus(accountId);
    const becameActive =
      status.charges_enabled && !tenant.stripe_connect_charges_enabled;
    await db().collection("tenants").doc(tenant.id).update({
      stripe_connect_charges_enabled: status.charges_enabled,
      stripe_connect_payouts_enabled: status.payouts_enabled,
      stripe_connect_details_submitted: status.details_submitted,
      updated_at: now(),
    });
    if (becameActive) {
      await writeAudit({
        action: "connect.onboard_complete",
        actorEmail: null,
        targetType: "tenant",
        targetId: tenant.id,
        after: { v2: true, ...status },
      });
    }
    return NextResponse.json({ ok: true, thin: thin.type, status });
  } catch (err) {
    console.error("[connect-webhook] thin handler", thin.type, err);
    return NextResponse.json({ error: "Thin handler error." }, { status: 500 });
  }
}

async function handlePaymentIntent(
  tenant: TenantDoc & { id: string },
  pi: Stripe.PaymentIntent,
): Promise<void> {
  const paymentsRef = tenantCol(tenant.id, "payments");
  const snap = await paymentsRef
    .where("stripe_payment_intent_id", "==", pi.id)
    .limit(1)
    .get();
  if (snap.empty) {
    // Maybe a charge created directly via Stripe Dashboard or an embed
    // booking that hasn't yet persisted its PaymentDoc — log and bail.
    console.warn("[connect-webhook] no PaymentDoc for", pi.id);
    return;
  }
  const doc = snap.docs[0];
  const data = doc.data() as PaymentDoc;

  // Pull card details + receipt from the latest charge if present
  const charge: Stripe.Charge | null =
    pi.latest_charge && typeof pi.latest_charge === "object"
      ? (pi.latest_charge as Stripe.Charge)
      : null;

  const updates: Record<string, unknown> = {
    status: mapStripePaymentStatus(pi.status),
    updated_at: now(),
  };
  if (charge) {
    updates.stripe_charge_id = charge.id;
    updates.receipt_url = charge.receipt_url ?? null;
    if (charge.payment_method_details?.card) {
      updates.card_brand = charge.payment_method_details.card.brand ?? null;
      updates.card_last4 = charge.payment_method_details.card.last4 ?? null;
    }
    if (charge.created) {
      updates.charged_at = Timestamp.fromMillis(charge.created * 1000);
    }
  }

  await doc.ref.update(updates);

  // Audit-log money movement, but only on terminal events (succeeded, failed)
  // to avoid noise on every state transition.
  if (pi.status === "succeeded") {
    await writeAudit({
      action: "payment.capture",
      actorEmail: null,
      targetType: "payment",
      targetId: doc.id,
      after: {
        amount_cents: data.amount_cents,
        kind: data.kind,
        ref_type: data.ref_type,
        ref_id: data.ref_id,
      },
    });
    // Generate + email a receipt PDF (best-effort, off the webhook path)
    void emailReceipt(tenant, { ...data, id: doc.id }).catch((err) =>
      console.error("[connect-webhook] receipt", err),
    );
  } else if (pi.status === "canceled" || pi.last_payment_error) {
    await writeAudit({
      action: "payment.fail",
      actorEmail: null,
      targetType: "payment",
      targetId: doc.id,
      after: {
        status: pi.status,
        error: pi.last_payment_error?.message ?? null,
      },
    });
  }
}

async function handleChargeRefunded(
  tenant: TenantDoc & { id: string },
  charge: Stripe.Charge,
): Promise<void> {
  const piId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;
  if (!piId) return;

  const snap = await tenantCol(tenant.id, "payments")
    .where("stripe_payment_intent_id", "==", piId)
    .limit(1)
    .get();
  if (snap.empty) return;

  const doc = snap.docs[0];
  const data = doc.data() as PaymentDoc;
  const refundedCents = charge.amount_refunded;
  const fullRefund = refundedCents >= data.amount_cents;
  await doc.ref.update({
    refunded_cents: refundedCents,
    status: fullRefund ? "refunded" : "partially_refunded",
    updated_at: now(),
  });
}

async function emailReceipt(
  tenant: TenantDoc & { id: string },
  payment: PaymentDoc & { id: string },
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!payment.client_id) return; // walk-in / unlinked charge

  const cliSnap = await tenantCol(tenant.id, "clients").doc(payment.client_id).get();
  if (!cliSnap.exists) return;
  const client = cliSnap.data() as ClientDoc;

  const { url } = await generateAndStoreReceipt({
    tenant,
    payment,
    clientName: client.full_name,
    clientEmail: client.email,
  });

  if (!resendKey || !client.email) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${tenant.name} <${PLATFORM_NOREPLY_EMAIL}>`,
      to: [client.email],
      reply_to: tenant.owner_email,
      subject: `${tenant.name} — receipt for ${(payment.amount_cents / 100).toFixed(2)}`,
      html: `
        <p>Hi ${client.full_name.split(" ")[0]},</p>
        <p>Thank you for visiting <strong>${tenant.name}</strong>. Your receipt is attached and available below for HSA/FSA records.</p>
        <p style="margin-top:20px"><a href="${url}" style="display:inline-block;padding:12px 24px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:8px;font-weight:600;">View receipt →</a></p>
        <p style="color:#888;font-size:12px;margin-top:24px">Total: $${(payment.amount_cents / 100).toFixed(2)}${
          payment.card_brand
            ? ` · ${payment.card_brand.toUpperCase()} •••• ${payment.card_last4 ?? ""}`
            : ""
        }</p>
      `,
    }),
  });
}

async function handleAccountUpdated(
  tenant: TenantDoc & { id: string },
  account: Stripe.Account,
): Promise<void> {
  await db().collection("tenants").doc(tenant.id).update({
    stripe_connect_charges_enabled: account.charges_enabled ?? false,
    stripe_connect_payouts_enabled: account.payouts_enabled ?? false,
    stripe_connect_details_submitted: account.details_submitted ?? false,
    updated_at: now(),
  });

  if (account.charges_enabled && !tenant.stripe_connect_charges_enabled) {
    await writeAudit({
      action: "connect.onboard_complete",
      actorEmail: null,
      targetType: "tenant",
      targetId: tenant.id,
      after: { charges_enabled: true },
    });
  }
}
