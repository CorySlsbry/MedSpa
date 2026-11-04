/**
 * POST /api/owner/products/[id]/movements  — record a stock movement,
 *      atomically adjust on_hand_quantity, return new balance.
 * GET  /api/owner/products/[id]/movements  — recent movement ledger
 *
 * Movement types:
 *   - "received": positive delta, e.g. shipment from supplier
 *   - "used": negative delta, manual override (auto-deduct happens on
 *     chart sign — this is for off-cycle uses)
 *   - "adjusted": signed delta (positive or negative) for count corrections
 *   - "expired": negative delta, write-off
 *   - "returned": positive delta
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now, toDate } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { checkFeature } from "@/lib/tier-limits";
import type {
  ProductDoc,
  ProductMovementDoc,
  ProductMovementType,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  type: z.enum(["received", "used", "adjusted", "expired", "returned"]),
  qty: z.number().refine((n) => n !== 0, "Qty cannot be zero."),
  reason: z.string().trim().max(500).optional(),
});

export async function GET(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const gate = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "inventory" });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message }, { status: 402 });
  }

  const { id } = await rctx.params;
  const snap = await tenantCol(ctx.tenant.id, "products")
    .doc(id)
    .collection("movements")
    .orderBy("created_at", "desc")
    .limit(100)
    .get()
    .catch(() => null);

  const movements =
    snap?.docs.map((d) => {
      const m = d.data() as ProductMovementDoc;
      return {
        id: d.id,
        type: m.type,
        delta: m.delta,
        balance_after: m.balance_after,
        reason: m.reason,
        ref_type: m.ref_type,
        ref_id: m.ref_id,
        actor_email: m.actor_email,
        created_at: toDate(m.created_at),
      };
    }) ?? [];

  return NextResponse.json({ ok: true, movements });
}

export async function POST(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const gate = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "inventory" });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message }, { status: 402 });
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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  // Sign the delta based on type. "adjusted" preserves the sign the caller
  // sent (so a negative qty for "adjusted" is a downward correction).
  const type = parsed.data.type as ProductMovementType;
  const rawQty = parsed.data.qty;
  let delta: number;
  switch (type) {
    case "received":
    case "returned":
      delta = Math.abs(rawQty);
      break;
    case "used":
    case "expired":
      delta = -Math.abs(rawQty);
      break;
    case "adjusted":
      delta = rawQty;
      break;
  }

  try {
    const result = await db().runTransaction<{ balance_after: number }>(async (trx) => {
      const productRef = tenantCol(ctx.tenant.id, "products").doc(id);
      const productSnap = await trx.get(productRef);
      if (!productSnap.exists) throw new Error("Not found.");
      const product = productSnap.data() as ProductDoc;
      const balanceAfter = product.on_hand_quantity + delta;

      const movementRef = productRef.collection("movements").doc();
      const movementDoc: Omit<ProductMovementDoc, "created_at"> & {
        created_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        product_id: id,
        type,
        delta,
        balance_after: balanceAfter,
        reason: parsed.data.reason ?? null,
        ref_type: null,
        ref_id: null,
        actor_user_id: ctx.user.firebaseUid,
        actor_email: ctx.user.email,
        created_at: now(),
      };

      trx.create(movementRef, movementDoc);
      trx.update(productRef, {
        on_hand_quantity: balanceAfter,
        updated_at: now(),
      });
      writeAuditInTx(trx, {
        action: "product.movement",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "product",
        targetId: id,
        before: { on_hand: product.on_hand_quantity },
        after: { on_hand: balanceAfter, type, delta, reason: parsed.data.reason ?? null },
        ip,
        userAgent: ua,
      });

      return { balance_after: balanceAfter };
    });

    return NextResponse.json({ ok: true, balance_after: result.balance_after });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "Not found." ? 404 : 500 },
    );
  }
}
