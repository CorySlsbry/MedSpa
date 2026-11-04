/**
 * POST /api/owner/payments/[id]/refund
 *
 * Issues a full or partial refund against a previously-captured
 * PaymentIntent. Updates PaymentDoc.refunded_cents + status.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { refundPayment } from "@/lib/payments";
import type { PaymentDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    amount_cents: z.number().int().min(1).optional(),
    reason: z
      .enum(["requested_by_customer", "duplicate", "fraudulent"])
      .optional(),
  })
  .strict();

export async function POST(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { id } = await rctx.params;
  if (!ctx.tenant.stripe_connect_account_id) {
    return NextResponse.json(
      { error: "Stripe Connect is not set up for this tenant." },
      { status: 400 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const ref = tenantCol(ctx.tenant.id, "payments").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }
  const payment = snap.data() as PaymentDoc;
  if (payment.status === "refunded") {
    return NextResponse.json({ error: "Already fully refunded." }, { status: 409 });
  }
  if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
    return NextResponse.json(
      { error: `Cannot refund a payment in status ${payment.status}.` },
      { status: 409 },
    );
  }
  const remaining = payment.amount_cents - payment.refunded_cents;
  if (parsed.data.amount_cents && parsed.data.amount_cents > remaining) {
    return NextResponse.json(
      { error: `Cannot refund more than $${(remaining / 100).toFixed(2)} remaining.` },
      { status: 400 },
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    const result = await refundPayment({
      tenantId: ctx.tenant.id,
      connectAccountId: ctx.tenant.stripe_connect_account_id,
      paymentIntentId: payment.stripe_payment_intent_id,
      amountCents: parsed.data.amount_cents,
      reason: parsed.data.reason,
    });

    await writeAudit({
      action: "payment.refund",
      actorEmail: ctx.user.email,
      actorUserId: ctx.user.firebaseUid,
      targetType: "payment",
      targetId: id,
      before: { refunded_cents: payment.refunded_cents, status: payment.status },
      after: {
        refunded_cents: result.refundedCents,
        full_refund: result.fullRefund,
        reason: parsed.data.reason ?? null,
      },
      ip,
      userAgent: ua,
    });

    return NextResponse.json({
      ok: true,
      refunded_cents: result.refundedCents,
      full_refund: result.fullRefund,
    });
  } catch (err) {
    console.error("[refund]", err);
    return NextResponse.json({ error: "Could not refund." }, { status: 500 });
  }
}
