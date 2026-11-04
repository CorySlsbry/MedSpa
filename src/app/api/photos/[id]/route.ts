/**
 * PATCH  /api/photos/[id]  — update kind / label / notes / pair_id / chart link
 * DELETE /api/photos/[id]  — remove from storage + delete doc
 *
 * Owner or provider in the same tenant. Photos linked to a SIGNED chart
 * cannot be deleted (PHI integrity); update is still allowed for
 * label/notes but kind/pair_id changes are blocked too.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { deleteObject } from "@/lib/storage";
import type { ChartDoc, PhotoDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z.object({
  kind: z.enum(["before", "after", "during", "other"]).optional(),
  label: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  pair_id: z.string().trim().max(120).nullable().optional(),
  appointment_id: z.string().trim().max(120).nullable().optional(),
  chart_id: z.string().trim().max(120).nullable().optional(),
  taken_at: z.string().datetime().nullable().optional(),
});

async function isLinkedToSignedChart(tenantId: string, photo: PhotoDoc): Promise<boolean> {
  if (!photo.chart_id) return false;
  const ref = tenantCol(tenantId, "charts").doc(photo.chart_id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  return (snap.data() as ChartDoc).status === "signed";
}

export async function PATCH(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.user.role !== "tenant_owner" && ctx.user.role !== "tenant_provider") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
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

  const ref = tenantCol(ctx.tenant.id, "photos").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const photo = snap.data() as PhotoDoc;

  const signedChart = await isLinkedToSignedChart(ctx.tenant.id, photo);
  // Allow label/notes edits on signed-chart-linked photos (admin notes
  // remain editable). Block kind/pair_id changes which would alter the
  // clinical record interpretation.
  if (signedChart) {
    const blocked: (keyof typeof parsed.data)[] = ["kind", "pair_id", "chart_id", "appointment_id"];
    for (const f of blocked) {
      if (parsed.data[f] !== undefined && parsed.data[f] !== photo[f as keyof PhotoDoc]) {
        return NextResponse.json(
          { error: `Photo is linked to a signed chart — ${f} is locked. Label and notes can still be edited.` },
          { status: 409 },
        );
      }
    }
  }

  const update: Record<string, unknown> = { updated_at: now() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) update[k] = v;
  }
  await ref.update(update);

  // Mirror pair_id on the partner if we just paired
  if (parsed.data.pair_id && parsed.data.pair_id !== photo.pair_id) {
    const partnerRef = tenantCol(ctx.tenant.id, "photos").doc(parsed.data.pair_id);
    await partnerRef.update({ pair_id: id, updated_at: now() }).catch(() => undefined);
  }

  await writeAudit({
    action: "note.create",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "photo.update",
    targetId: id,
    after: parsed.data as Record<string, unknown>,
  }).catch((err) => console.error("[photos-patch] audit", err));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.user.role !== "tenant_owner" && ctx.user.role !== "tenant_provider") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { id } = await rctx.params;
  const ref = tenantCol(ctx.tenant.id, "photos").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const photo = snap.data() as PhotoDoc;

  if (await isLinkedToSignedChart(ctx.tenant.id, photo)) {
    return NextResponse.json(
      { error: "Photo is linked to a signed chart and cannot be deleted." },
      { status: 409 },
    );
  }

  // Best-effort storage delete first; even if it fails (already missing),
  // we still remove the doc.
  await deleteObject(photo.storage_path).catch((err) =>
    console.error("[photos-delete] storage delete failed", err),
  );
  // Unlink any partner pair_id back-pointer
  if (photo.pair_id) {
    await tenantCol(ctx.tenant.id, "photos")
      .doc(photo.pair_id)
      .update({ pair_id: null, updated_at: now() })
      .catch(() => undefined);
  }
  await ref.delete();

  await writeAudit({
    action: "note.delete",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "photo.delete",
    targetId: id,
    before: { client_id: photo.client_id, kind: photo.kind, bytes: photo.byte_size },
  }).catch((err) => console.error("[photos-delete] audit", err));

  return NextResponse.json({ ok: true });
}
