/**
 * POST /api/photos/upload-url
 *
 * Step 1 of two-step upload. Owner or provider in the same tenant
 * requests a signed PUT URL + planned doc id. Client PUTs the file
 * directly to GCS, then calls POST /api/photos to finalize the
 * PhotoDoc.
 *
 * Tier-gated by photos_before_after feature flag.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db } from "@/lib/firestore";
import { checkFeature } from "@/lib/tier-limits";
import { isAllowedContentType, buildPhotoPath, signedUploadUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB per photo

const Body = z.object({
  client_id: z.string().trim().min(1).max(120),
  content_type: z.string().trim().min(1).max(60),
  byte_size: z.number().int().positive().max(MAX_BYTES),
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
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;
  if (!isAllowedContentType(data.content_type)) {
    return NextResponse.json(
      { error: "Only JPEG, PNG, WebP, or HEIC images are accepted." },
      { status: 400 },
    );
  }

  // Verify client belongs to this tenant
  const cliSnap = await tenantCol(ctx.tenant.id, "clients").doc(data.client_id).get();
  if (!cliSnap.exists) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  // Pre-allocate the photo doc id so the storage path is stable + we can
  // round-trip it through the upload step.
  const photoRef = tenantCol(ctx.tenant.id, "photos").doc();
  const storagePath = buildPhotoPath({
    tenantId: ctx.tenant.id,
    clientId: data.client_id,
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

const _db = db; // keep import referenced (used indirectly via tenantCol)
void _db;
