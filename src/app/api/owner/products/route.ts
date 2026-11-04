/**
 * GET  /api/owner/products  — list active + recently archived
 * POST /api/owner/products  — create new product (SKU)
 *
 * Tier-gated: only tenants whose tier has features.inventory=true.
 * Owner-only.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now, toDate } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { checkFeature } from "@/lib/tier-limits";
import type { ProductDoc, ProductUnit } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(64).optional(),
  unit: z.enum(["unit", "ml", "vial", "ea", "syringe"]).default("unit"),
  on_hand_quantity: z.number().min(0).max(1_000_000).default(0),
  reorder_threshold: z.number().min(0).max(1_000_000).optional().nullable(),
  cost_cents_per_unit: z.number().int().min(0).max(10_000_000).optional().nullable(),
  supplier: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function GET() {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const gate = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "inventory" });
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.message, upgrade_to: gate.upgrade_to },
      { status: 402 },
    );
  }

  const snap = await tenantCol(ctx.tenant.id, "products")
    .orderBy("name", "asc")
    .limit(500)
    .get()
    .catch(() => null);
  if (!snap) {
    return NextResponse.json({ ok: true, products: [] });
  }
  const products = snap.docs.map((d) => {
    const p = d.data() as ProductDoc;
    return {
      id: d.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      on_hand_quantity: p.on_hand_quantity,
      reorder_threshold: p.reorder_threshold,
      cost_cents_per_unit: p.cost_cents_per_unit,
      supplier: p.supplier,
      notes: p.notes,
      is_active: p.is_active,
      archived_at: toDate(p.archived_at),
      low_stock:
        p.is_active &&
        p.reorder_threshold !== null &&
        p.reorder_threshold !== undefined &&
        p.on_hand_quantity <= p.reorder_threshold,
      created_at: toDate(p.created_at),
      updated_at: toDate(p.updated_at),
    };
  });

  return NextResponse.json({ ok: true, products });
}

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const gate = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "inventory" });
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.message, upgrade_to: gate.upgrade_to },
      { status: 402 },
    );
  }

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

  try {
    const id = await db().runTransaction<string>(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "products").doc();
      const doc: Omit<ProductDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        name: data.name,
        sku: data.sku ?? null,
        unit: data.unit as ProductUnit,
        on_hand_quantity: data.on_hand_quantity,
        reorder_threshold: data.reorder_threshold ?? null,
        cost_cents_per_unit: data.cost_cents_per_unit ?? null,
        supplier: data.supplier ?? null,
        notes: data.notes ?? null,
        is_active: true,
        archived_at: null,
        last_low_stock_alert_at: null,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(ref, doc);
      writeAuditInTx(trx, {
        action: "product.create",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "product",
        targetId: ref.id,
        after: { name: data.name, unit: data.unit, on_hand: data.on_hand_quantity },
        ip,
        userAgent: ua,
      });
      return ref.id;
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[products-post]", err);
    return NextResponse.json({ error: "Could not create product." }, { status: 500 });
  }
}
