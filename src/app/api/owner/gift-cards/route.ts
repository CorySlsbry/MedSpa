/**
 * GET  /api/owner/gift-cards  — list (latest 200, optionally fully-redeemed)
 * POST /api/owner/gift-cards  — create + (optionally) charge
 *
 * Modes:
 *   purchased: creates a PaymentIntent, returns client_secret. Card is
 *     active immediately; the buyer's card capture happens in the front-
 *     desk Stripe Elements step.
 *   comp / manual: no charge. Card is active immediately.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now, toDate } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { createPayment } from "@/lib/payments";
import { generateGiftCardCode } from "@/lib/gift-cards";
import type { GiftCardDoc, GiftCardSource } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z
  .object({
    amount_cents: z.number().int().min(500).max(10_000_000),
    source: z.enum(["purchased", "comp", "manual"]).default("purchased"),
    recipient_email: z.string().trim().toLowerCase().email().optional(),
    recipient_name: z.string().trim().max(120).optional(),
    sender_name: z.string().trim().max(120).optional(),
    message: z.string().trim().max(500).optional(),
    expires_in_days: z.number().int().min(1).max(3650).optional(),
    /** When source=purchased AND a client_id is supplied, the receipt
     *  email goes to the client. Otherwise to recipient_email. */
    purchaser_client_id: z.string().optional(),
  })
  .strict();

export async function GET() {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const snap = await tenantCol(ctx.tenant.id, "gift_cards")
    .orderBy("created_at", "desc")
    .limit(200)
    .get()
    .catch(() => null);
  if (!snap) return NextResponse.json({ ok: true, cards: [] });

  return NextResponse.json({
    ok: true,
    cards: snap.docs.map((d) => {
      const c = d.data() as GiftCardDoc;
      return {
        code: d.id,
        original_amount_cents: c.original_amount_cents,
        balance_cents: c.balance_cents,
        recipient_email: c.recipient_email,
        recipient_name: c.recipient_name,
        sender_name: c.sender_name,
        message: c.message,
        expires_at: toDate(c.expires_at),
        source: c.source,
        payment_id: c.payment_id,
        fully_redeemed_at: toDate(c.fully_redeemed_at),
        created_at: toDate(c.created_at),
      };
    }),
  });
}

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Create.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  if (data.source === "purchased") {
    if (
      !ctx.tenant.stripe_connect_account_id ||
      !ctx.tenant.stripe_connect_charges_enabled
    ) {
      return NextResponse.json(
        { error: "Stripe Connect must be live to take payment." },
        { status: 400 },
      );
    }
  }

  // Create the gift card first so we have a stable code to put in the
  // PaymentIntent metadata.
  const code = generateGiftCardCode();
  const expiresAt = data.expires_in_days
    ? new Date(Date.now() + data.expires_in_days * 24 * 60 * 60 * 1000)
    : null;

  const cardRef = tenantCol(ctx.tenant.id, "gift_cards").doc(code);
  const cardDoc: Omit<GiftCardDoc, "created_at" | "updated_at"> & {
    created_at: ReturnType<typeof now>;
    updated_at: ReturnType<typeof now>;
  } = {
    tenant_id: ctx.tenant.id,
    code,
    original_amount_cents: data.amount_cents,
    balance_cents: data.amount_cents,
    recipient_email: data.recipient_email ?? null,
    recipient_name: data.recipient_name ?? null,
    sender_name: data.sender_name ?? null,
    message: data.message ?? null,
    expires_at: expiresAt ? Timestamp.fromDate(expiresAt) : null,
    source: data.source as GiftCardSource,
    payment_id: null,
    fully_redeemed_at: null,
    created_at: now(),
    updated_at: now(),
  };
  await cardRef.create(cardDoc);

  // (Optional) charge
  let clientSecret: string | null = null;
  let paymentDocId: string | null = null;
  if (data.source === "purchased") {
    const pay = await createPayment({
      tenant: ctx.tenant,
      kind: "gift_card",
      amountCents: data.amount_cents,
      clientId: data.purchaser_client_id ?? null,
      receiptEmail: data.recipient_email ?? null,
      refType: "gift_card",
      refId: code,
      description: `Gift card · ${code}`,
    });
    paymentDocId = pay.paymentDocId;
    clientSecret = pay.clientSecret;
    await cardRef.update({ payment_id: paymentDocId, updated_at: now() });
  }

  await writeAudit({
    action: "gift_card.create",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "gift_card",
    targetId: code,
    after: {
      amount_cents: data.amount_cents,
      source: data.source,
      recipient_email: data.recipient_email ?? null,
    },
    ip,
    userAgent: ua,
  });

  return NextResponse.json({
    ok: true,
    code,
    balance_cents: data.amount_cents,
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    payment_id: paymentDocId,
    client_secret: clientSecret,
    publishable_key: clientSecret ? process.env.STRIPE_PUBLISHABLE_KEY ?? null : null,
    stripe_account_id: clientSecret ? ctx.tenant.stripe_connect_account_id : null,
  });
}
