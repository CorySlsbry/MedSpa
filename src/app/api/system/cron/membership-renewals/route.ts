/**
 * POST /api/system/cron/membership-renewals
 *
 * Daily renewal sweeper. For every active membership with auto_bill=true
 * whose current_period_end has passed:
 *   1. Charge the saved payment_method off-session (PaymentIntent on
 *      the connected account, application_fee per tier).
 *   2. On success: roll the period forward, add the plan's renewal
 *      credit, log a charge ledger row.
 *   3. On failure: increment failed_payment_count, set status=past_due,
 *      send the member a payment-update email.
 *   4. After 3 failed attempts: status=canceled, send cancellation email.
 *
 * Runs as a Cloud Scheduler job (daily, 13:00 UTC = 6 AM Pacific) so
 * dunning happens before business hours.
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { authorizeCron } from "@/lib/cron-auth";
import {
  applicationFeeBps,
  calcApplicationFeeCents,
  isStripeConfigured,
  stripe,
} from "@/lib/stripe";
import { writeAudit } from "@/lib/audit";
import { PLATFORM_NOREPLY_EMAIL } from "@/lib/email";
import type {
  ClientDoc,
  ClientMembershipDoc,
  MembershipPlanDoc,
  TenantDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAILED_ATTEMPTS = 3;

export async function POST(req: Request) {
  const auth = authorizeCron(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe not configured." }, { status: 503 });
  }

  const counts = { scanned: 0, renewed: 0, failed: 0, canceled: 0 };
  const dueAt = Timestamp.fromDate(new Date(Date.now() + 60 * 60 * 1000)); // 1h grace
  const snap = await db()
    .collectionGroup("client_memberships")
    .where("auto_bill", "==", true)
    .where("status", "in", ["active", "past_due"])
    .where("current_period_end", "<=", dueAt)
    .limit(500)
    .get();

  for (const doc of snap.docs) {
    counts.scanned++;
    try {
      const result = await processOne(doc.id, doc.ref);
      if (result === "renewed") counts.renewed++;
      else if (result === "failed") counts.failed++;
      else if (result === "canceled") counts.canceled++;
    } catch (err) {
      console.error("[membership-renewals]", doc.id, err);
    }
  }

  return NextResponse.json({ ok: true, ...counts });
}

type Outcome = "renewed" | "failed" | "canceled" | "skipped";

async function processOne(
  membershipId: string,
  ref: FirebaseFirestore.DocumentReference,
): Promise<Outcome> {
  const snap = await ref.get();
  if (!snap.exists) return "skipped";
  const m = snap.data() as ClientMembershipDoc;

  // Resolve tenant for connect account + tier (for application fee)
  const tenantSnap = await db().collection("tenants").doc(m.tenant_id).get();
  if (!tenantSnap.exists) return "skipped";
  const tenant = tenantSnap.data() as TenantDoc;

  if (!tenant.stripe_connect_charges_enabled || !tenant.stripe_connect_account_id) {
    // Tenant lost Connect — leave membership alone, owner needs to fix
    return "skipped";
  }
  if (!m.stripe_customer_id || !m.stripe_payment_method_id) {
    // Owner enabled auto_bill but never collected the card
    return "skipped";
  }

  // Look up the plan to get the renewal credit
  const planSnap = await ref.parent.parent
    ?.collection("membership_plans")
    .doc(m.plan_id)
    .get();
  const plan = planSnap?.exists ? (planSnap.data() as MembershipPlanDoc) : null;
  const renewCredit = plan?.credit_per_period_cents ?? 0;

  const amountCents = m.price_cents_snapshot;
  const applicationFee = calcApplicationFeeCents(amountCents, tenant.subscription_tier);

  // Attempt the off-session PaymentIntent
  let succeeded = false;
  let lastError: string | null = null;
  let paymentIntentId: string | null = null;

  try {
    const intent = await stripe().paymentIntents.create(
      {
        amount: amountCents,
        currency: "usd",
        customer: m.stripe_customer_id,
        payment_method: m.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        application_fee_amount: applicationFee > 0 ? applicationFee : undefined,
        description: `${m.plan_name_snapshot} — renewal`,
        metadata: {
          aesthera_tenant_slug: m.tenant_id,
          aesthera_kind: "membership",
          aesthera_ref_type: "client_membership",
          aesthera_ref_id: membershipId,
          application_fee_bps: applicationFeeBps(tenant.subscription_tier).toString(),
        },
      },
      { stripeAccount: tenant.stripe_connect_account_id },
    );
    succeeded = intent.status === "succeeded";
    paymentIntentId = intent.id;
    if (!succeeded) {
      lastError = `PaymentIntent in status ${intent.status}`;
    }
  } catch (err) {
    const stripeErr = err as { message?: string; code?: string };
    lastError = stripeErr.message ?? "Unknown error";
  }

  if (succeeded) {
    // Roll period + log charge + reset failed counter
    const newPeriodStart = m.current_period_end;
    const newPeriodEnd = rollPeriodEnd(
      newPeriodStart.toDate(),
      m.billing_period_snapshot,
    );
    await ref.update({
      status: "active",
      current_period_start: newPeriodStart,
      current_period_end: Timestamp.fromDate(newPeriodEnd),
      next_renewal_at: Timestamp.fromDate(newPeriodEnd),
      balance_cents: m.balance_cents + renewCredit,
      failed_payment_count: 0,
      last_payment_attempt_at: now(),
      last_payment_error: null,
      updated_at: now(),
    });
    if (paymentIntentId) {
      // Persist a PaymentDoc for the renewal too — webhook will reconcile
      // it later, but seeding the row makes the ledger immediately accurate.
      await ref.parent.parent?.collection("payments").add({
        tenant_id: m.tenant_id,
        client_id: m.client_id,
        kind: "membership",
        amount_cents: amountCents,
        tip_cents: 0,
        tax_cents: 0,
        application_fee_cents: applicationFee,
        currency: "usd",
        status: "succeeded",
        stripe_payment_intent_id: paymentIntentId,
        stripe_charge_id: null,
        stripe_customer_id: m.stripe_customer_id,
        card_brand: m.card_brand,
        card_last4: m.card_last4,
        receipt_url: null,
        refunded_cents: 0,
        ref_type: "client_membership",
        ref_id: membershipId,
        description: `${m.plan_name_snapshot} renewal`,
        charged_at: now(),
        created_at: now(),
        updated_at: now(),
      });
    }
    // Append to charges ledger
    await ref.collection("charges").add({
      tenant_id: m.tenant_id,
      membership_id: membershipId,
      client_id: m.client_id,
      type: "renewal",
      amount_cents: renewCredit,
      balance_after_cents: m.balance_cents + renewCredit,
      reason: "Auto-renewed",
      ref_type: "stripe",
      ref_id: paymentIntentId,
      actor_user_id: null,
      actor_email: null,
      created_at: now(),
    });
    await writeAudit({
      action: "membership.renew",
      actorEmail: null,
      targetType: "client_membership",
      targetId: membershipId,
      after: {
        amount_cents: amountCents,
        auto: true,
        client_id: m.client_id,
      },
    });
    return "renewed";
  }

  // Failure path
  const newFailedCount = m.failed_payment_count + 1;
  const willCancel = newFailedCount >= MAX_FAILED_ATTEMPTS;
  await ref.update({
    status: willCancel ? "canceled" : "past_due",
    failed_payment_count: newFailedCount,
    last_payment_attempt_at: now(),
    last_payment_error: lastError,
    canceled_at: willCancel ? now() : null,
    auto_bill: willCancel ? false : m.auto_bill,
    updated_at: now(),
  });
  await writeAudit({
    action: willCancel ? "membership.cancel" : "membership.charge",
    actorEmail: null,
    targetType: "client_membership",
    targetId: membershipId,
    after: {
      reason: willCancel ? "auto_canceled_after_failures" : "renewal_failed",
      failed_count: newFailedCount,
      error: lastError,
    },
  });
  void emailDunning(tenant, m, willCancel).catch((err) =>
    console.error("[membership-renewals] dunning email", err),
  );
  return willCancel ? "canceled" : "failed";
}

function rollPeriodEnd(start: Date, period: ClientMembershipDoc["billing_period_snapshot"]): Date {
  const d = new Date(start);
  if (period === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

async function emailDunning(
  tenant: TenantDoc,
  m: ClientMembershipDoc,
  canceled: boolean,
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  const cliSnap = await db().collection("tenants").doc(m.tenant_id).collection("clients").doc(m.client_id).get();
  if (!cliSnap.exists) return;
  const client = cliSnap.data() as ClientDoc;
  if (!client.email) return;

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://aesthera.io";
  const subject = canceled
    ? `${tenant.name} — your ${m.plan_name_snapshot} membership has been canceled`
    : `${tenant.name} — payment for ${m.plan_name_snapshot} couldn't be processed`;

  const body = canceled
    ? `
      <p>Hi ${client.full_name.split(" ")[0]},</p>
      <p>After several attempts, we weren't able to process payment for your <strong>${m.plan_name_snapshot}</strong> membership. We've canceled it for now to avoid further charges.</p>
      <p>If you'd like to restart, just reply to this email and we'll get you set back up.</p>
      <p>— ${tenant.name}</p>
    `
    : `
      <p>Hi ${client.full_name.split(" ")[0]},</p>
      <p>We weren't able to process the renewal for your <strong>${m.plan_name_snapshot}</strong> membership.</p>
      <p>We'll try again automatically. To update your card now and avoid interruption, please contact us or reply to this email.</p>
      <p>— ${tenant.name}</p>
      <p style="font-size:12px;color:#888;margin-top:32px">
        Site: <a href="${baseUrl}">${baseUrl}</a>
      </p>
    `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${tenant.name} <${PLATFORM_NOREPLY_EMAIL}>`,
      to: [client.email],
      reply_to: tenant.owner_email,
      subject,
      html: body,
    }),
  });
}
