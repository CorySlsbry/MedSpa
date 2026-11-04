/**
 * GET  /api/owner/providers/[id]/availability — current weekly schedule
 * PUT  /api/owner/providers/[id]/availability — replace the schedule
 *
 * Owner-only. Provider self-edit endpoint lives at
 * /api/provider/availability for the provider portal.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { DEFAULT_INTERVALS } from "@/lib/availability";
import type { ProviderAvailabilityDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    intervals: z
      .array(
        z.object({
          day: z.number().int().min(0).max(6),
          start: z.number().int().min(0).max(1440),
          end: z.number().int().min(0).max(1440),
        }),
      )
      .max(50),
    template: z.string().trim().max(64).nullable().optional(),
  })
  .strict()
  .refine(
    (d) => d.intervals.every((iv) => iv.end > iv.start),
    { message: "Each interval's end must be after its start." },
  );

export async function GET(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { id } = await rctx.params;
  const ref = tenantCol(ctx.tenant.id, "providers").doc(id).collection("availability").doc("weekly");
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({
      ok: true,
      intervals: DEFAULT_INTERVALS,
      template: "default-9-5",
      is_default: true,
    });
  }
  const data = snap.data() as ProviderAvailabilityDoc;
  return NextResponse.json({
    ok: true,
    intervals: data.intervals,
    template: data.template,
    is_default: false,
  });
}

export async function PUT(
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
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const ref = tenantCol(ctx.tenant.id, "providers").doc(id).collection("availability").doc("weekly");
  await ref.set(
    {
      tenant_id: ctx.tenant.id,
      provider_id: id,
      intervals: parsed.data.intervals,
      template: parsed.data.template ?? null,
      created_at: now(),
      updated_at: now(),
    },
    { merge: true },
  );

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;
  await writeAudit({
    action: "provider.availability",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "provider",
    targetId: id,
    after: { interval_count: parsed.data.intervals.length },
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true });
}
