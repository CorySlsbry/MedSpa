/**
 * PATCH  /api/owner/products/[id]  — update fields (does NOT change on_hand;
 *                                    use /movements for stock adjustments)
 * DELETE /api/owner/products/[id]  — soft-archive (is_active=false)
 *
 * On-hand changes go through /api/owner/products/[id]/movements so the
 * ledger always agrees with the live count.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { checkFeature } from "@/lib/tier-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  sku: z.string().trim().max(64).optional().nullable(),
  unit: z.enum(["unit", "ml", "vial", "ea", "syringe"]).optional(),
  reorder_threshold: z.number().min(0).max(1_000_000).optional().nullable(),
  cost_cents_per_unit: z.number().int().min(0).max(10_000_000).optional().nullable(),
  supplier: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(
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
  const parsed = Patch.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    await db().runTransaction(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "products").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Not found.");

      // Disallow unit change once movements exist — past movements'
      // balance_after are denominated in the original unit. If the
      // owner truly needs to change unit, they should archive this
      // product and create a fresh one.
      if (parsed.data.unit !== undefined) {
        const movementsSnap = await trx.get(ref.collection("movements").limit(1));
        if (!movementsSnap.empty) {
          throw new Error(
            "Cannot change unit on a product with movement history. Archive and recreate.",
          );
        }
      }

      trx.update(ref, { ...parsed.data, updated_at: now() });
      writeAuditInTx(trx, {
        action: "product.update",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "product",
        targetId: id,
        after: parsed.data,
        ip,
        userAgent: ua,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    let status = 500;
    if (msg === "Not found.") status = 404;
    else if (msg.includes("Cannot change unit")) status = 409;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(
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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    await db().runTransaction(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "products").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Not found.");
      trx.update(ref, {
        is_active: false,
        archived_at: now(),
        updated_at: now(),
      });
      writeAuditInTx(trx, {
        action: "product.archive",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "product",
        targetId: id,
        after: { is_active: false },
        ip,
        userAgent: ua,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "Not found." ? 404 : 500 },
    );
  }
}
