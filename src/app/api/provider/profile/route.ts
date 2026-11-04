/**
 * PATCH /api/provider/profile  — provider self-edit
 *
 * A provider can update their own display fields (name, title, phone,
 * scheduling color, default location). They CANNOT change tenant_id,
 * email, or is_active — those are owner-controlled.
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
  full_name: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().max(80).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  scheduling_color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex.")
    .optional(),
  default_location_id: z.string().trim().max(60).optional().nullable(),
});

export async function PATCH(req: Request) {
  const ctx = await requireTenantContextApi("tenant_provider");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

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
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    await db().runTransaction(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "providers").doc(ctx.user.firebaseUid);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Provider record not found.");
      trx.update(ref, { ...parsed.data, updated_at: now() });
      writeAuditInTx(trx, {
        action: "admin.user_create",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "provider.self_update",
        targetId: ctx.user.firebaseUid,
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
      { status: msg.includes("not found") ? 404 : 500 },
    );
  }
}
