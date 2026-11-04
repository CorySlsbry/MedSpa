/**
 * POST /api/photos/pair-upload
 *
 * Token-authenticated photo upload — used by the public phone-handoff
 * page at /photo-capture/[token]. The token grants ephemeral upload
 * rights for ONE specific (tenant, client, appointment, chart) tuple
 * with a 30-minute TTL.
 *
 * Two-step flow same as the authenticated upload:
 *   - mode=init   → returns signed PUT URL + photo_id
 *   - mode=finalize → writes the PhotoDoc after PUT succeeds
 *
 * Token validation: lookup in tenants/{slug}/photo_pair_tokens/{token},
 * check it isn't expired or revoked. Tenant-scoped Firestore access
 * means a token from tenant A can never write to tenant B.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { tenantCol } from "@/lib/tenant";
import { isAllowedContentType, buildPhotoPath, signedUploadUrl, fileExists } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";
import type { PhotoDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

const InitBody = z.object({
  mode: z.literal("init"),
  token: z.string().trim().min(20).max(200),
  content_type: z.string().trim().min(1).max(60),
  byte_size: z.number().int().positive().max(MAX_BYTES),
});

const FinalizeBody = z.object({
  mode: z.literal("finalize"),
  token: z.string().trim().min(20).max(200),
  photo_id: z.string().trim().min(1).max(120),
  storage_path: z.string().trim().min(1).max(500),
  content_type: z.string().trim().min(1).max(60),
  width: z.number().int().nonnegative().nullable().optional(),
  height: z.number().int().nonnegative().nullable().optional(),
  kind: z.enum(["before", "after", "during", "other"]).default("during"),
});

const Body = z.discriminatedUnion("mode", [InitBody, FinalizeBody]);

type PairTokenDoc = {
  tenant_id: string;
  client_id: string;
  appointment_id: string | null;
  chart_id: string | null;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
};

async function resolveToken(
  token: string,
): Promise<{ ok: true; tenantId: string; doc: PairTokenDoc } | { ok: false; error: string; status: number }> {
  // Tokens live in the ROOT collection `photo_pair_tokens` (not nested
  // under tenants) so this public endpoint can look them up by id alone.
  // The token doc itself carries tenant_id — we use that for all
  // downstream tenant-scoped writes.
  const snap = await db().collection("photo_pair_tokens").doc(token).get().catch(() => null);
  if (!snap || !snap.exists) {
    return { ok: false, status: 404, error: "Pairing link not found or already expired." };
  }
  const data = snap.data() as PairTokenDoc;
  if (data.revoked_at) return { ok: false, status: 410, error: "This pairing link has been ended." };
  const exp = data.expires_at?.toDate?.() ?? null;
  if (!exp || exp.getTime() < Date.now()) {
    return { ok: false, status: 410, error: "This pairing link has expired. Ask the provider to start a new one." };
  }
  return { ok: true, tenantId: data.tenant_id, doc: data };
}

export async function POST(req: Request) {
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
  const data = parsed.data;

  const tok = await resolveToken(data.token);
  if (!tok.ok) {
    return NextResponse.json({ error: tok.error }, { status: tok.status });
  }
  const tenantId = tok.tenantId;
  const scope = tok.doc;

  if (data.mode === "init") {
    if (!isAllowedContentType(data.content_type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, WebP, or HEIC images are accepted." },
        { status: 400 },
      );
    }
    const photoRef = tenantCol(tenantId, "photos").doc();
    const storagePath = buildPhotoPath({
      tenantId,
      clientId: scope.client_id,
      photoId: photoRef.id,
      contentType: data.content_type,
    });
    const { url, expires_at } = await signedUploadUrl({
      storagePath,
      contentType: data.content_type,
      maxBytes: MAX_BYTES,
    });
    return NextResponse.json({
      ok: true,
      photo_id: photoRef.id,
      storage_path: storagePath,
      upload_url: url,
      expires_at,
      max_bytes: MAX_BYTES,
      required_headers: {
        "Content-Type": data.content_type,
        "x-goog-content-length-range": `0,${MAX_BYTES}`,
      },
    });
  }

  // mode === "finalize"
  const expectedPrefix = `tenants/${tenantId}/clients/${scope.client_id}/`;
  if (!data.storage_path.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: "Storage path scope mismatch." }, { status: 403 });
  }
  const exists = await fileExists(data.storage_path);
  if (!exists.exists) {
    return NextResponse.json(
      { error: "Upload not found in storage. Re-upload and retry." },
      { status: 409 },
    );
  }
  const ref = tenantCol(tenantId, "photos").doc(data.photo_id);
  const existingDoc = await ref.get();
  if (existingDoc.exists) {
    return NextResponse.json({ error: "Photo already finalized." }, { status: 409 });
  }
  const doc: Omit<PhotoDoc, "created_at" | "updated_at"> & {
    created_at: ReturnType<typeof now>;
    updated_at: ReturnType<typeof now>;
  } = {
    tenant_id: tenantId,
    client_id: scope.client_id,
    appointment_id: scope.appointment_id,
    chart_id: scope.chart_id,
    storage_path: data.storage_path,
    thumbnail_path: null,
    content_type: data.content_type,
    byte_size: exists.bytes,
    width: data.width ?? null,
    height: data.height ?? null,
    kind: data.kind,
    label: null,
    notes: "Captured via phone-handoff (pair token)",
    taken_at: Timestamp.now(),
    pair_id: null,
    uploaded_by_user_id: null, // No authenticated user — token-based upload
    created_at: now(),
    updated_at: now(),
  };
  await ref.set(doc);

  void writeAudit({
    action: "note.create",
    actorEmail: null,
    actorUserId: null,
    targetType: "photo.pair_upload",
    targetId: ref.id,
    after: {
      tenant_id: tenantId,
      client_id: scope.client_id,
      kind: data.kind,
      bytes: exists.bytes,
      via: "phone_pair_token",
    },
  }).catch((err) => console.error("[photo-pair-upload] audit", err));

  return NextResponse.json({ ok: true, id: ref.id });
}
