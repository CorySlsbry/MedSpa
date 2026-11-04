/**
 * PATCH /api/owner/services/[id]   — update
 * DELETE /api/owner/services/[id]  — soft-delete (is_active=false)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  category: z.enum([
    "injectables",
    "facial",
    "laser",
    "body",
    "iv_therapy",
    "wellness",
    "consultation",
    "other",
  ]).optional(),
  duration_minutes: z.number().int().min(5).max(480).optional(),
  price_cents: z.number().int().min(0).max(10_000_000).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  is_active: z.boolean().optional(),
  consumes: z
    .array(
      z.object({
        product_id: z.string().min(1),
        qty: z.number().positive().max(10_000),
      }),
    )
    .max(20)
    .optional()
    .nullable(),
  deposit_cents: z.number().int().min(0).max(10_000_000).optional().nullable(),
  recommended_rebook_days: z.number().int().min(1).max(365).optional().nullable(),
});

export async function PATCH(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
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
      const ref = tenantCol(ctx.tenant.id, "services").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Not found.");

      // If consumes array is being set, validate every product_id exists.
      // Reads-before-writes: read existence first, then update.
      if (parsed.data.consumes && parsed.data.consumes.length > 0) {
        const productSnaps = await Promise.all(
          parsed.data.consumes.map((c) =>
            trx.get(tenantCol(ctx.tenant.id, "products").doc(c.product_id)),
          ),
        );
        const missing = productSnaps.findIndex((s) => !s.exists);
        if (missing >= 0) {
          throw new Error(`Product not found: ${parsed.data.consumes[missing].product_id}`);
        }
      }

      trx.update(ref, { ...parsed.data, updated_at: now() });
      writeAuditInTx(trx, {
        action: "service.update",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "service",
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
    else if (msg.startsWith("Product not found")) status = 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { id } = await rctx.params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    await db().runTransaction(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "services").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Not found.");
      trx.update(ref, { is_active: false, updated_at: now() });
      writeAuditInTx(trx, {
        action: "service.archive",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "service",
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
