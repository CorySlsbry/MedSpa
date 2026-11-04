/**
 * POST /api/owner/payments/charge
 *
 * Creates a PaymentIntent on the tenant's connected account. This is
 * the OWNER-initiated path — for ad-hoc charges from the front desk
 * (cash close-out, walk-in retail, etc.). Embed booking deposits,
 * package purchases, gift card sales, and membership renewals each
 * have their own narrower endpoints that share the same lib helper.
 *
 * Returns { client_secret, payment_intent_id, amount_cents } so the
 * caller (front-desk UI) can confirm via Stripe.js.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { writeAudit } from "@/lib/audit";
import { createPayment } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    amount_cents: z.number().int().min(50).max(10_000_000),
    tip_cents: z.number().int().min(0).max(10_000_000).default(0),
    tax_cents: z.number().int().min(0).max(10_000_000).default(0),
    client_id: z.string().optional(),
    client_email: z.string().trim().toLowerCase().email().optional(),
    description: z.string().trim().max(500).optional(),
    appointment_id: z.string().optional(),
    capture_method: z.enum(["automatic", "manual"]).default("automatic"),
  })
  .strict();

export async function POST(req: Request) {
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
  const data = parsed.data;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  // Tip + tax are subsets of amount_cents for clarity
  if (data.tip_cents + data.tax_cents > data.amount_cents) {
    return NextResponse.json(
      { error: "Tip + tax cannot exceed total amount." },
      { status: 400 },
    );
  }

  try {
    const result = await createPayment({
      tenant: ctx.tenant,
      kind: data.appointment_id ? "visit" : "other",
      amountCents: data.amount_cents,
      tipCents: data.tip_cents,
      taxCents: data.tax_cents,
      clientId: data.client_id ?? null,
      receiptEmail: data.client_email ?? null,
      captureMethod: data.capture_method,
      refType: data.appointment_id ? "appointment" : null,
      refId: data.appointment_id ?? null,
      description: data.description,
    });

    await writeAudit({
      action: "payment.create",
      actorEmail: ctx.user.email,
      actorUserId: ctx.user.firebaseUid,
      targetType: "payment",
      targetId: result.paymentDocId,
      after: {
        kind: data.appointment_id ? "visit" : "other",
        amount_cents: data.amount_cents,
        appointment_id: data.appointment_id ?? null,
      },
      ip,
      userAgent: ua,
    });

    return NextResponse.json({
      ok: true,
      payment_id: result.paymentDocId,
      payment_intent_id: result.paymentIntentId,
      client_secret: result.clientSecret,
      amount_cents: result.amountCents,
      application_fee_cents: result.applicationFeeCents,
      status: result.status,
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg.includes("not set up") || msg.includes("not yet enabled") ? 400 : 500 },
    );
  }
}
