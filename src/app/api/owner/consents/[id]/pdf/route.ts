/**
 * GET /api/owner/consents/[id]/pdf
 *
 * Returns a 15-minute signed read URL for the rendered consent PDF.
 * Owner-only.
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { signedReadUrl } from "@/lib/storage";
import type { ConsentDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { id } = await rctx.params;
  const snap = await tenantCol(ctx.tenant.id, "consents").doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const c = snap.data() as ConsentDoc;
  if (!c.pdf_storage_path) {
    return NextResponse.json({ error: "Consent not signed yet." }, { status: 409 });
  }
  const { url, expires_at } = await signedReadUrl({ storagePath: c.pdf_storage_path });
  return NextResponse.json({ ok: true, url, expires_at });
}
