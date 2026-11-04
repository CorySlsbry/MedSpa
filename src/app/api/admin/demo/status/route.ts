/**
 * GET /api/admin/demo/status
 *
 * Super-admin only. Reports whether the demo tenant exists and, if so,
 * returns saved credentials + a quick health snapshot (counts of major
 * subcollections). Used by the /admin/demo launcher to decide between
 * Seed and Teardown.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-server";
import { db } from "@/lib/firestore";
import { tenantCol } from "@/lib/tenant";
import { DEMO_TENANT_SLUG, type SeedUser } from "@/lib/demo-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const snap = await db().collection("tenants").doc(DEMO_TENANT_SLUG).get();
  if (!snap.exists) {
    return NextResponse.json({ ok: true, exists: false });
  }
  const data = snap.data() as { name?: string; demo_credentials?: SeedUser[] };

  const [appts, clients, leads, runs, locations, providers, services, products] = await Promise.all([
    tenantCol(DEMO_TENANT_SLUG, "appointments").count().get().catch(() => null),
    tenantCol(DEMO_TENANT_SLUG, "clients").count().get().catch(() => null),
    db().collection("leads").where("raw_payload.demo", "==", true).count().get().catch(() => null),
    tenantCol(DEMO_TENANT_SLUG, "campaign_runs").count().get().catch(() => null),
    tenantCol(DEMO_TENANT_SLUG, "locations").count().get().catch(() => null),
    tenantCol(DEMO_TENANT_SLUG, "providers").count().get().catch(() => null),
    tenantCol(DEMO_TENANT_SLUG, "services").count().get().catch(() => null),
    tenantCol(DEMO_TENANT_SLUG, "products").count().get().catch(() => null),
  ]);

  return NextResponse.json({
    ok: true,
    exists: true,
    slug: DEMO_TENANT_SLUG,
    name: data.name ?? DEMO_TENANT_SLUG,
    credentials: data.demo_credentials ?? [],
    counts: {
      appointments: appts?.data().count ?? 0,
      clients: clients?.data().count ?? 0,
      leads: leads?.data().count ?? 0,
      campaign_runs: runs?.data().count ?? 0,
      locations: locations?.data().count ?? 0,
      providers: providers?.data().count ?? 0,
      services: services?.data().count ?? 0,
      products: products?.data().count ?? 0,
    },
  });
}
