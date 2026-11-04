/**
 * POST /api/owner/client-memberships/[id]/save-card
 *
 * After the SetupIntent confirms client-side, the owner UI POSTs the
 * resulting setup_intent_id here. We resolve the SetupIntent on the
 * connected account, persist the payment_method ID + card brand/last4
 * on the membership doc, and flip auto_bill=true.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { isStripeConfigured, stripe } from "@/lib/stripe";
import { writeAudit } from "@/lib/audit";
import type { ClientMembershipDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ setup_intent_id: z.string().min(1) }).strict();

export async function POST(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!isStripeConfigured() || !ctx.tenant.stripe_connect_account_id) {
    return NextResponse.json({ error: "Stripe Connect not configured." }, { status: 503 });
  }

  const { id } = await rctx.params;
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

  const ref = tenantCol(ctx.tenant.id, "client_memberships").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const m = snap.data() as ClientMembershipDoc;

  try {
    const setup = await stripe().setupIntents.retrieve(
      parsed.data.setup_intent_id,
      undefined,
      { stripeAccount: ctx.tenant.stripe_connect_account_id ?? undefined },
    );
    if (setup.status !== "succeeded") {
      return NextResponse.json(
        { error: `SetupIntent is in status ${setup.status}, not succeeded.` },
        { status: 400 },
      );
    }
    const pmId =
      typeof setup.payment_method === "string"
        ? setup.payment_method
        : setup.payment_method?.id;
    if (!pmId) {
      return NextResponse.json({ error: "No payment method on the SetupIntent." }, { status: 400 });
    }
    const pm = await stripe().paymentMethods.retrieve(
      pmId,
      undefined,
      { stripeAccount: ctx.tenant.stripe_connect_account_id ?? undefined },
    );

    await ref.update({
      stripe_payment_method_id: pmId,
      card_brand: pm.card?.brand ?? null,
      card_last4: pm.card?.last4 ?? null,
      auto_bill: true,
      failed_payment_count: 0,
      last_payment_error: null,
      updated_at: now(),
    });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const ua = req.headers.get("user-agent") || null;
    await writeAudit({
      action: "membership.charge",
      actorEmail: ctx.user.email,
      actorUserId: ctx.user.firebaseUid,
      targetType: "client_membership",
      targetId: id,
      after: {
        action: "card_saved",
        card_brand: pm.card?.brand ?? null,
        card_last4: pm.card?.last4 ?? null,
        client_id: m.client_id,
      },
      ip,
      userAgent: ua,
    });

    return NextResponse.json({
      ok: true,
      card_brand: pm.card?.brand ?? null,
      card_last4: pm.card?.last4 ?? null,
    });
  } catch (err) {
    console.error("[save-card]", err);
    return NextResponse.json({ error: "Could not save card." }, { status: 500 });
  }
}
