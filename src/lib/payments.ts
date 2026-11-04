/**
 * Payment helpers — wraps Stripe PaymentIntent creation against the
 * tenant's connected account, computes platform application fee, and
 * persists a PaymentDoc row in `tenants/{slug}/payments`.
 *
 * Every charge in Aesthera goes through this single helper so the
 * ledger is consistent regardless of whether the trigger was a visit
 * checkout, a deposit hold, a package purchase, a gift card sale, or
 * a membership renewal.
 */

import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "./firestore";
import { tenantCol } from "./tenant";
import {
  stripe,
  calcApplicationFeeCents,
} from "./stripe";
import type {
  PaymentDoc,
  PaymentKind,
  TenantDoc,
} from "./firestore-types";

export type CreatePaymentArgs = {
  tenant: TenantDoc & { id: string };
  kind: PaymentKind;
  amountCents: number;
  /** Tip portion. Already inside amountCents — caller computes amount. */
  tipCents?: number;
  /** Tax portion. Already inside amountCents. */
  taxCents?: number;
  currency?: string; // defaults to "usd"
  clientId?: string | null;
  /** When omitted, the payment is uncaptured (manual capture for deposits). */
  captureMethod?: "automatic" | "manual";
  /** Stripe customer ID (for off-session reuse, e.g. memberships). */
  customerId?: string | null;
  /** Set on the PaymentIntent so the customer is set up to be charged later. */
  setupForFutureUse?: boolean;
  refType?: PaymentDoc["ref_type"];
  refId?: string | null;
  description?: string;
  receiptEmail?: string | null;
  /** Optional metadata to pass to Stripe. Aesthera tenant_slug is always added. */
  metadata?: Record<string, string>;
};

export type CreatePaymentResult = {
  paymentDocId: string;
  paymentIntentId: string;
  clientSecret: string | null;
  amountCents: number;
  applicationFeeCents: number;
  status: PaymentDoc["status"];
};

const STATUS_MAP: Record<string, PaymentDoc["status"]> = {
  requires_payment_method: "requires_payment_method",
  requires_confirmation: "requires_confirmation",
  requires_action: "requires_action",
  processing: "processing",
  requires_capture: "requires_capture",
  succeeded: "succeeded",
  canceled: "canceled",
};

export function mapStripePaymentStatus(s: string | null | undefined): PaymentDoc["status"] {
  if (!s) return "failed";
  return STATUS_MAP[s] ?? "failed";
}

/**
 * Create a PaymentIntent on the tenant's connected account and persist
 * a PaymentDoc. Returns the client_secret for browser confirmation.
 */
export async function createPayment(args: CreatePaymentArgs): Promise<CreatePaymentResult> {
  if (!args.tenant.stripe_connect_account_id) {
    throw new Error(
      "Stripe Connect is not set up for this tenant. Owner must complete onboarding first.",
    );
  }
  if (!args.tenant.stripe_connect_charges_enabled) {
    throw new Error(
      "Stripe charges are not yet enabled. Finish onboarding to start accepting payments.",
    );
  }

  const currency = args.currency ?? "usd";
  const applicationFee = calcApplicationFeeCents(args.amountCents, args.tenant.subscription_tier);

  const intent = await stripe().paymentIntents.create(
    {
      amount: args.amountCents,
      currency,
      application_fee_amount: applicationFee > 0 ? applicationFee : undefined,
      capture_method: args.captureMethod ?? "automatic",
      customer: args.customerId ?? undefined,
      description: args.description,
      receipt_email: args.receiptEmail ?? undefined,
      setup_future_usage: args.setupForFutureUse ? "off_session" : undefined,
      automatic_payment_methods: { enabled: true },
      metadata: {
        aesthera_tenant_slug: args.tenant.id,
        aesthera_kind: args.kind,
        aesthera_ref_type: args.refType ?? "",
        aesthera_ref_id: args.refId ?? "",
        ...(args.metadata ?? {}),
      },
    },
    { stripeAccount: args.tenant.stripe_connect_account_id },
  );

  // Persist the ledger row
  const ref = tenantCol(args.tenant.id, "payments").doc();
  const docPayload: Omit<PaymentDoc, "created_at" | "updated_at"> & {
    created_at: ReturnType<typeof now>;
    updated_at: ReturnType<typeof now>;
  } = {
    tenant_id: args.tenant.id,
    client_id: args.clientId ?? null,
    kind: args.kind,
    amount_cents: args.amountCents,
    tip_cents: args.tipCents ?? 0,
    tax_cents: args.taxCents ?? 0,
    application_fee_cents: applicationFee,
    currency,
    status: mapStripePaymentStatus(intent.status),
    stripe_payment_intent_id: intent.id,
    stripe_charge_id: null,
    stripe_customer_id: args.customerId ?? null,
    card_brand: null,
    card_last4: null,
    receipt_url: null,
    refunded_cents: 0,
    ref_type: args.refType ?? null,
    ref_id: args.refId ?? null,
    description: args.description ?? null,
    charged_at: Timestamp.now(),
    created_at: now(),
    updated_at: now(),
  };
  await ref.create(docPayload);

  return {
    paymentDocId: ref.id,
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    amountCents: args.amountCents,
    applicationFeeCents: applicationFee,
    status: mapStripePaymentStatus(intent.status),
  };
}

/**
 * Capture a previously-authorized (uncaptured) PaymentIntent. Used for
 * deposits — held when the appointment is booked, captured when the
 * client shows up.
 */
export async function capturePayment(args: {
  tenantId: string;
  connectAccountId: string;
  paymentIntentId: string;
  amountToCaptureCents?: number;
}): Promise<void> {
  await stripe().paymentIntents.capture(
    args.paymentIntentId,
    args.amountToCaptureCents
      ? { amount_to_capture: args.amountToCaptureCents }
      : undefined,
    { stripeAccount: args.connectAccountId },
  );
  // Webhook will update PaymentDoc.status; we also patch eagerly:
  const snap = await tenantCol(args.tenantId, "payments")
    .where("stripe_payment_intent_id", "==", args.paymentIntentId)
    .limit(1)
    .get();
  if (!snap.empty) {
    await snap.docs[0].ref.update({
      status: "succeeded",
      updated_at: now(),
    });
  }
}

/**
 * Refund a payment, full or partial. Updates PaymentDoc.refunded_cents
 * + status. Supports both Connect direct charges and platform charges.
 */
export async function refundPayment(args: {
  tenantId: string;
  connectAccountId: string;
  paymentIntentId: string;
  amountCents?: number; // omit for full refund
  reason?: "requested_by_customer" | "duplicate" | "fraudulent";
}): Promise<{ refundedCents: number; fullRefund: boolean }> {
  const refund = await stripe().refunds.create(
    {
      payment_intent: args.paymentIntentId,
      amount: args.amountCents,
      reason: args.reason,
    },
    { stripeAccount: args.connectAccountId },
  );

  const snap = await tenantCol(args.tenantId, "payments")
    .where("stripe_payment_intent_id", "==", args.paymentIntentId)
    .limit(1)
    .get();
  if (snap.empty) {
    return { refundedCents: refund.amount, fullRefund: false };
  }
  const doc = snap.docs[0];
  const data = doc.data() as PaymentDoc;
  const newRefunded = data.refunded_cents + refund.amount;
  const fullRefund = newRefunded >= data.amount_cents;
  await doc.ref.update({
    refunded_cents: newRefunded,
    status: fullRefund ? "refunded" : "partially_refunded",
    updated_at: now(),
  });
  return { refundedCents: newRefunded, fullRefund };
}

/**
 * Lookup the tenant by Connect account ID. Used by the webhook handler
 * to route Stripe events back to the right tenant doc.
 */
export async function tenantBySlug(slug: string): Promise<(TenantDoc & { id: string }) | null> {
  const snap = await db().collection("tenants").doc(slug).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as TenantDoc) };
}

export async function tenantByConnectAccount(
  accountId: string,
): Promise<(TenantDoc & { id: string }) | null> {
  const snap = await db()
    .collection("tenants")
    .where("stripe_connect_account_id", "==", accountId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...(snap.docs[0].data() as TenantDoc) };
}
