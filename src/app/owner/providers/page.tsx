import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import ProvidersView from "@/components/owner/ProvidersView";
import type { ProviderDoc, LocationDoc } from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Owner · Providers",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type ProviderRow = {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  phone: string | null;
  schedulingColor: string | null;
  defaultLocationId: string | null;
  isActive: boolean;
  createdAt: Date | null;
};

export type LocationOption = { id: string; name: string };

async function loadProviders(tenantId: string): Promise<ProviderRow[]> {
  const snap = await tenantCol(tenantId, "providers")
    .orderBy("created_at", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as ProviderDoc;
    return {
      id: d.id,
      email: data.email,
      fullName: data.full_name,
      title: data.title,
      phone: data.phone,
      schedulingColor: data.scheduling_color,
      defaultLocationId: data.default_location_id,
      isActive: data.is_active,
      createdAt: toDate(data.created_at),
    };
  });
}

async function loadLocationOptions(tenantId: string): Promise<LocationOption[]> {
  const snap = await tenantCol(tenantId, "locations")
    .where("is_active", "==", true)
    .orderBy("created_at", "asc")
    .limit(50)
    .get();
  return snap.docs.map((d) => ({ id: d.id, name: (d.data() as LocationDoc).name }));
}

export default async function ProvidersPage() {
  const ctx = await requireTenantContext("tenant_owner");
  let rows: ProviderRow[] = [];
  let locations: LocationOption[] = [];
  let errorMsg: string | null = null;
  try {
    [rows, locations] = await Promise.all([
      loadProviders(ctx.tenant.id),
      loadLocationOptions(ctx.tenant.id),
    ]);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Providers
        </h1>
        <span className="text-sm text-[var(--color-ink-muted)]">
          {rows.filter((r) => r.isActive).length} active
        </span>
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Add providers (injectors, aestheticians, RNs, NPs, MDs) to your team.
        Each gets a magic-link invite to set up their account.
      </p>

      {errorMsg && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {errorMsg}
        </div>
      )}

      <div className="mt-6">
        <ProvidersView initialRows={rows} locations={locations} />
      </div>
    </div>
  );
}
