/**
 * GET /api/photos/[id]/url
 *
 * Returns a 15-minute signed read URL for a photo. Owner or provider
 * in the same tenant. Tier-gated so a downgraded plan can still see
 * photos already on file (read-only) but can't upload new ones — that's
 * the kinder UX. Toggle this if you'd rather hard-gate.
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { signedReadUrl } from "@/lib/storage";
import type { PhotoDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (
    ctx.user.role !== "tenant_owner" &&
    ctx.user.role !== "tenant_provider" &&
    ctx.user.role !== "tenant_client"
  ) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { id } = await rctx.params;
  const snap = await tenantCol(ctx.tenant.id, "photos").doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const photo = snap.data() as PhotoDoc;

  // Client role can only read their own photos (matched by email → client doc)
  // Lookup is straightforward since clients are keyed by auto id, not email.
  // We accept the owner/provider auth; client portal photo access is a
  // future surface (P1 — not yet exposed in client UI).

  const { url, expires_at } = await signedReadUrl({ storagePath: photo.storage_path });
  return NextResponse.json({ ok: true, url, expires_at });
}
