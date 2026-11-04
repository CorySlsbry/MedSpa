/**
 * POST /api/owner/gift-cards/[code]/redeem
 *
 * Draws down balance_cents on a gift card. Optional applied_to/ref_id
 * tags it to an appointment or package. Decrements transactionally;
 * blocks overdraw + expired cards.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import type { GiftCardDoc, GiftCardRedemptionDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    amount_cents: z.number().int().min(1).max(10_000_000),
    applied_to: z.enum(["appointment", "package", "manual"]).default("manual"),
    ref_id: z.string().optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .strict();

export async function POST(
  req: Request,
  rctx: { params: Promise<{ code: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { code } = await rctx.params;

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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    const balance_after = await db().runTransaction<number>(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "gift_cards").doc(code);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Card not found.");
      const card = snap.data() as GiftCardDoc;
      if (card.expires_at && card.expires_at.toDate().getTime() < Date.now()) {
        throw new Error("Card has expired.");
      }
      if (card.balance_cents < parsed.data.amount_cents) {
        throw new Error(
          `Card balance is $${(card.balance_cents / 100).toFixed(2)}; cannot redeem $${(parsed.data.amount_cents / 100).toFixed(2)}.`,
        );
      }
      const newBalance = card.balance_cents - parsed.data.amount_cents;
      const fully = newBalance === 0;
      trx.update(ref, {
        balance_cents: newBalance,
        fully_redeemed_at: fully ? now() : card.fully_redeemed_at,
        updated_at: now(),
      });
      const redRef = ref.collection("redemptions").doc();
      const redDoc: Omit<GiftCardRedemptionDoc, "created_at"> & {
        created_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        gift_card_code: code,
        amount_cents: parsed.data.amount_cents,
        balance_after_cents: newBalance,
        applied_to: parsed.data.applied_to,
        ref_id: parsed.data.ref_id ?? null,
        actor_user_id: ctx.user.firebaseUid,
        actor_email: ctx.user.email,
        created_at: now(),
      };
      trx.create(redRef, redDoc);
      writeAuditInTx(trx, {
        action: "gift_card.redeem",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "gift_card",
        targetId: code,
        before: { balance_cents: card.balance_cents },
        after: {
          balance_cents: newBalance,
          drawn_cents: parsed.data.amount_cents,
          applied_to: parsed.data.applied_to,
          ref_id: parsed.data.ref_id ?? null,
        },
        ip,
        userAgent: ua,
      });
      return newBalance;
    });
    return NextResponse.json({ ok: true, balance_cents: balance_after });
  } catch (err) {
    const msg = (err as Error).message;
    let status = 500;
    if (msg.includes("not found")) status = 404;
    else if (msg.includes("expired") || msg.includes("balance is")) status = 409;
    return NextResponse.json({ error: msg }, { status });
  }
}
