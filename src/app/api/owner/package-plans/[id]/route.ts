/**
 * PATCH /api/owner/package-plans/[id]  — update fields
 * DELETE /api/owner/package-plans/[id] — soft archive
 *
 * Plan edits do NOT mutate existing ClientPackageDocs (they hold snapshots).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).optional().nullable(),
    service_name: z.string().trim().min(1).max(120).optional(),
    sessions_total: z.number().int().min(1).max(100).optional(),
    price_cents: z.number().int().min(0).max(10_000_000).optional(),
    expires_in_days: z.number().int().min(1).max(3650).optional().nullable(),
    is_active: z.boolean().optional(),
  })
  .strict();

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
      const ref = tenantCol(ctx.tenant.id, "package_plans").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Not found.");
      trx.update(ref, { ...parsed.data, updated_at: now() });
      writeAuditInTx(trx, {
        action: "package_plan.update",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "package_plan",
        targetId: id,
        after: parsed.data,
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
      const ref = tenantCol(ctx.tenant.id, "package_plans").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Not found.");
      trx.update(ref, { is_active: false, updated_at: now() });
      writeAuditInTx(trx, {
        action: "package_plan.archive",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "package_plan",
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
