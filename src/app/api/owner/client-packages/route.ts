/**
 * GET /api/owner/client-packages?client_id=...
 *
 * Lists active client packages, optionally filtered by client. Used by
 * the front-desk UI to show "Sarah has 3 HydraFacial sessions remaining."
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import type { ClientDoc, ClientPackageDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const url = new URL(req.url);
  const clientId = url.searchParams.get("client_id");

  let q = tenantCol(ctx.tenant.id, "client_packages")
    .orderBy("created_at", "desc")
    .limit(500) as FirebaseFirestore.Query;
  if (clientId) {
    q = tenantCol(ctx.tenant.id, "client_packages")
      .where("client_id", "==", clientId)
      .orderBy("created_at", "desc")
      .limit(50);
  }
  const snap = await q.get().catch(() => null);
  if (!snap) return NextResponse.json({ ok: true, packages: [] });

  // Resolve client names if not filtered to one
  const clientIds = new Set<string>();
  for (const d of snap.docs) {
    const c = d.data() as ClientPackageDoc;
    clientIds.add(c.client_id);
  }
  const clientMap = new Map<string, string>();
  await Promise.all(
    [...clientIds].map(async (cid) => {
      const cs = await tenantCol(ctx.tenant.id, "clients").doc(cid).get().catch(() => null);
      if (cs && cs.exists) clientMap.set(cid, (cs.data() as ClientDoc).full_name);
    }),
  );

  const packages = snap.docs.map((d) => {
    const p = d.data() as ClientPackageDoc;
    return {
      id: d.id,
      client_id: p.client_id,
      client_name: clientMap.get(p.client_id) ?? null,
      plan_id: p.plan_id,
      plan_name: p.plan_name_snapshot,
      service_name: p.service_name_snapshot,
      sessions_total: p.sessions_total,
      sessions_remaining: p.sessions_remaining,
      price_cents: p.price_cents_snapshot,
      source: p.source,
      expires_at: toDate(p.expires_at),
      payment_id: p.payment_id,
      created_at: toDate(p.created_at),
      is_exhausted: p.sessions_remaining <= 0,
      is_expired: p.expires_at ? p.expires_at.toDate().getTime() < Date.now() : false,
    };
  });

  return NextResponse.json({ ok: true, packages });
}
