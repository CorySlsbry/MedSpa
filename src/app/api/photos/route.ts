/**
 * GET /api/photos?client_id=...|appointment_id=...|chart_id=...  — list
 * POST /api/photos                                                 — finalize
 *
 * Photo finalize step writes the PhotoDoc after a successful PUT to GCS.
 * Owner or provider in the same tenant.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { checkFeature } from "@/lib/tier-limits";
import { fileExists } from "@/lib/storage";
import type { PhotoDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Finalize = z.object({
  photo_id: z.string().trim().min(1).max(120),
  client_id: z.string().trim().min(1).max(120),
  appointment_id: z.string().trim().max(120).nullable().optional(),
  chart_id: z.string().trim().max(120).nullable().optional(),
  storage_path: z.string().trim().min(1).max(500),
  content_type: z.string().trim().min(1).max(60),
  width: z.number().int().nonnegative().nullable().optional(),
  height: z.number().int().nonnegative().nullable().optional(),
  kind: z.enum(["before", "after", "during", "other"]).default("other"),
  label: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  taken_at: z.string().datetime().nullable().optional(),
});

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.user.role !== "tenant_owner" && ctx.user.role !== "tenant_provider") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const feat = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "photos_before_after" });
  if (!feat.ok) {
    return NextResponse.json(
      { error: feat.message, upgrade_to: feat.upgrade_to },
      { status: 402 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Finalize.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Storage path must match the tenant + client scope (defense-in-depth)
  const expectedPrefix = `tenants/${ctx.tenant.id}/clients/${data.client_id}/`;
  if (!data.storage_path.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: "Storage path scope mismatch." }, { status: 403 });
  }

  // Confirm the file actually got uploaded
  const exists = await fileExists(data.storage_path);
  if (!exists.exists) {
    return NextResponse.json(
      { error: "Upload not found in storage. Re-upload and retry." },
      { status: 409 },
    );
  }

  const ref = tenantCol(ctx.tenant.id, "photos").doc(data.photo_id);
  const existingDoc = await ref.get();
  if (existingDoc.exists) {
    return NextResponse.json({ error: "Photo already finalized." }, { status: 409 });
  }

  const doc: Omit<PhotoDoc, "created_at" | "updated_at"> & {
    created_at: ReturnType<typeof now>;
    updated_at: ReturnType<typeof now>;
  } = {
    tenant_id: ctx.tenant.id,
    client_id: data.client_id,
    appointment_id: data.appointment_id ?? null,
    chart_id: data.chart_id ?? null,
    storage_path: data.storage_path,
    thumbnail_path: null,
    content_type: data.content_type,
    byte_size: exists.bytes,
    width: data.width ?? null,
    height: data.height ?? null,
    kind: data.kind,
    label: data.label ?? null,
    notes: data.notes ?? null,
    taken_at: data.taken_at ? Timestamp.fromDate(new Date(data.taken_at)) : null,
    pair_id: null,
    uploaded_by_user_id: ctx.user.firebaseUid,
    created_at: now(),
    updated_at: now(),
  };
  await ref.set(doc);

  await writeAudit({
    action: "note.create",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "photo",
    targetId: ref.id,
    after: {
      tenant_id: ctx.tenant.id,
      client_id: data.client_id,
      kind: data.kind,
      bytes: exists.bytes,
      // No content/path leaked into audit body
    },
  }).catch((err) => console.error("[photos-finalize] audit", err));

  return NextResponse.json({ ok: true, id: ref.id });
}

export async function GET(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.user.role !== "tenant_owner" && ctx.user.role !== "tenant_provider") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get("client_id");
  const appointmentId = url.searchParams.get("appointment_id");
  const chartId = url.searchParams.get("chart_id");

  let q: FirebaseFirestore.Query = tenantCol(ctx.tenant.id, "photos");
  if (clientId) q = q.where("client_id", "==", clientId);
  if (appointmentId) q = q.where("appointment_id", "==", appointmentId);
  if (chartId) q = q.where("chart_id", "==", chartId);
  const snap = await q.orderBy("created_at", "desc").limit(200).get().catch(() => null);
  if (!snap) {
    return NextResponse.json({ ok: true, photos: [], note: "no index yet" });
  }

  const photos = snap.docs.map((d) => {
    const p = d.data() as PhotoDoc;
    return {
      id: d.id,
      client_id: p.client_id,
      appointment_id: p.appointment_id,
      chart_id: p.chart_id,
      storage_path: p.storage_path,
      content_type: p.content_type,
      byte_size: p.byte_size,
      kind: p.kind,
      label: p.label,
      notes: p.notes,
      taken_at: p.taken_at instanceof Timestamp ? p.taken_at.toDate().toISOString() : null,
      pair_id: p.pair_id,
      width: p.width,
      height: p.height,
      created_at: (p.created_at as Timestamp)?.toDate().toISOString() ?? null,
    };
  });

  return NextResponse.json({ ok: true, photos });
}
