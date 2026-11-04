/**
 * POST   /api/owner/waitlist/[id]/notify  — mark notified + (optional) SMS
 * DELETE /api/owner/waitlist/[id]         — remove
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchBody = z
  .object({
    status: z.enum(["active", "notified", "booked", "cancelled"]).optional(),
    booked_appointment_id: z.string().optional().nullable(),
  })
  .strict();

export async function PATCH(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!["tenant_owner", "tenant_manager", "tenant_front_desk"].includes(ctx.user.role)) {
    return NextResponse.json({ error: "Waitlist is owner / manager / front-desk only." }, { status: 403 });
  }
  const { id } = await rctx.params;
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  await db().runTransaction(async (trx) => {
    const ref = tenantCol(ctx.tenant.id, "waitlist").doc(id);
    const snap = await trx.get(ref);
    if (!snap.exists) throw new Error("Not found.");
    const updates: Record<string, unknown> = { updated_at: now() };
    if (parsed.data.status) updates.status = parsed.data.status;
    if (parsed.data.status === "notified") updates.notified_at = now();
    if (parsed.data.booked_appointment_id !== undefined)
      updates.booked_appointment_id = parsed.data.booked_appointment_id;
    trx.update(ref, updates);
  });

  await writeAudit({
    action: "waitlist.notify",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "waitlist",
    targetId: id,
    after: parsed.data,
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!["tenant_owner", "tenant_manager", "tenant_front_desk"].includes(ctx.user.role)) {
    return NextResponse.json({ error: "Waitlist is owner / manager / front-desk only." }, { status: 403 });
  }
  const { id } = await rctx.params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;
  await tenantCol(ctx.tenant.id, "waitlist").doc(id).delete();
  await writeAudit({
    action: "waitlist.remove",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "waitlist",
    targetId: id,
    ip,
    userAgent: ua,
  });
  return NextResponse.json({ ok: true });
}
