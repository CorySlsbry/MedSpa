/**
 * PATCH /api/owner/campaigns/[id] — update campaign (status, brief, etc)
 * DELETE /api/owner/campaigns/[id] — archive (soft via status='archived')
 *
 * Owner-only.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import type { CampaignDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z.object({
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  brief: z.string().trim().min(1).max(1000).optional(),
  call_to_action: z.string().trim().max(120).nullable().optional(),
  cooldown_days: z.number().int().min(0).max(365).optional(),
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

  const ref = tenantCol(ctx.tenant.id, "campaigns").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const before = snap.data() as CampaignDoc;

  const update: Record<string, unknown> = { updated_at: now() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) update[k] = v;
  }
  await ref.update(update);

  await writeAudit({
    action: "admin.user_create",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "campaign",
    targetId: id,
    before: { status: before.status, name: before.name },
    after: parsed.data,
  }).catch((err) => console.error("[campaigns] audit", err));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { id } = await rctx.params;
  const ref = tenantCol(ctx.tenant.id, "campaigns").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  await ref.update({ status: "archived", updated_at: now() });

  await writeAudit({
    action: "admin.user_suspend",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "campaign",
    targetId: id,
    after: { status: "archived" },
  }).catch((err) => console.error("[campaigns] audit", err));

  return NextResponse.json({ ok: true });
}
