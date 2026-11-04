/**
 * GET  /api/owner/package-plans  — list active + recently archived
 * POST /api/owner/package-plans  — create a series template
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now, toDate } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import type { PackagePlanDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    service_name: z.string().trim().min(1).max(120),
    sessions_total: z.number().int().min(1).max(100),
    price_cents: z.number().int().min(0).max(10_000_000),
    expires_in_days: z.number().int().min(1).max(3650).optional().nullable(),
  })
  .strict();

export async function GET() {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const snap = await tenantCol(ctx.tenant.id, "package_plans")
    .orderBy("name", "asc")
    .limit(100)
    .get()
    .catch(() => null);
  if (!snap) return NextResponse.json({ ok: true, plans: [] });

  return NextResponse.json({
    ok: true,
    plans: snap.docs.map((d) => {
      const p = d.data() as PackagePlanDoc;
      return {
        id: d.id,
        name: p.name,
        description: p.description,
        service_name: p.service_name,
        sessions_total: p.sessions_total,
        price_cents: p.price_cents,
        expires_in_days: p.expires_in_days,
        is_active: p.is_active,
        created_at: toDate(p.created_at),
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

  try {
    const id = await db().runTransaction<string>(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "package_plans").doc();
      const doc: Omit<PackagePlanDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        name: data.name,
        description: data.description ?? null,
        service_name: data.service_name,
        sessions_total: data.sessions_total,
        price_cents: data.price_cents,
        expires_in_days: data.expires_in_days ?? null,
        is_active: true,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(ref, doc);
      writeAuditInTx(trx, {
        action: "package_plan.create",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "package_plan",
        targetId: ref.id,
        after: { name: data.name, sessions_total: data.sessions_total, price_cents: data.price_cents },
        ip,
        userAgent: ua,
      });
      return ref.id;
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[package-plans-post]", err);
    return NextResponse.json({ error: "Could not create package plan." }, { status: 500 });
  }
}
