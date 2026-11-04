/**
 * PATCH  /api/owner/consent-templates/[id]  — edit (bumps version on body change)
 * DELETE /api/owner/consent-templates/[id]  — archive (soft)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { FieldValue } from "firebase-admin/firestore";
import type { ConsentTemplateDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  body: z.string().trim().min(20).max(20000).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
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

  const ref = tenantCol(ctx.tenant.id, "consent_templates").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const before = snap.data() as ConsentTemplateDoc;

  const update: Record<string, unknown> = { updated_at: now() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) update[k] = v;
  }
  if (parsed.data.body !== undefined && parsed.data.body !== before.body) {
    update.version = FieldValue.increment(1);
  }
  await ref.update(update);

  await writeAudit({
    action: "admin.user_create",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "consent_template.update",
    targetId: id,
    before: { status: before.status, version: before.version },
    after: parsed.data as Record<string, unknown>,
  }).catch((err) => console.error("[consent-template] audit", err));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { id } = await rctx.params;
  const ref = tenantCol(ctx.tenant.id, "consent_templates").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await ref.update({ status: "archived", updated_at: now() });
  await writeAudit({
    action: "admin.user_suspend",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "consent_template.archive",
    targetId: id,
  }).catch((err) => console.error("[consent-template] audit", err));
  return NextResponse.json({ ok: true });
}
