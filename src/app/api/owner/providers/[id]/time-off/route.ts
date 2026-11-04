/**
 * GET  /api/owner/providers/[id]/time-off — list upcoming + recent
 * POST /api/owner/providers/[id]/time-off — add a blackout range
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now, toDate } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import type { ProviderTimeOffDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime(),
    reason: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((d) => new Date(d.ends_at) > new Date(d.starts_at), {
    message: "End must be after start.",
  });

export async function GET(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { id } = await rctx.params;

  const earliest = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30d + future
  const snap = await tenantCol(ctx.tenant.id, "providers")
    .doc(id)
    .collection("time_off")
    .where("ends_at", ">=", Timestamp.fromDate(earliest))
    .orderBy("ends_at", "asc")
    .limit(100)
    .get()
    .catch(() => null);

  const ranges =
    snap?.docs.map((d) => {
      const t = d.data() as ProviderTimeOffDoc;
      return {
        id: d.id,
        starts_at: toDate(t.starts_at),
        ends_at: toDate(t.ends_at),
        reason: t.reason,
      };
    }) ?? [];

  return NextResponse.json({ ok: true, ranges });
}

export async function POST(
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

  const ref = tenantCol(ctx.tenant.id, "providers")
    .doc(id)
    .collection("time_off")
    .doc();
  const doc: Omit<ProviderTimeOffDoc, "created_at" | "updated_at"> & {
    created_at: ReturnType<typeof now>;
    updated_at: ReturnType<typeof now>;
  } = {
    tenant_id: ctx.tenant.id,
    provider_id: id,
    starts_at: Timestamp.fromDate(new Date(parsed.data.starts_at)),
    ends_at: Timestamp.fromDate(new Date(parsed.data.ends_at)),
    reason: parsed.data.reason ?? null,
    created_at: now(),
    updated_at: now(),
  };
  await ref.create(doc);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;
  await writeAudit({
    action: "provider.time_off",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "provider",
    targetId: id,
    after: {
      starts_at: parsed.data.starts_at,
      ends_at: parsed.data.ends_at,
      reason: parsed.data.reason ?? null,
    },
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true, id: ref.id });
}
