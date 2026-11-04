/**
 * DELETE /api/owner/providers/[id]/time-off/[rangeId]
 *
 * Remove a blackout range. No effect on existing appointments.
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  rctx: { params: Promise<{ id: string; rangeId: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { id, rangeId } = await rctx.params;
  await tenantCol(ctx.tenant.id, "providers")
    .doc(id)
    .collection("time_off")
    .doc(rangeId)
    .delete();
  return NextResponse.json({ ok: true });
}
