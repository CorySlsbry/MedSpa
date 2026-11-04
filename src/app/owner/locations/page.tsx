import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import LocationsView from "@/components/owner/LocationsView";
import type { LocationDoc } from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Owner · Locations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type LocationRow = {
  id: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  timezone: string;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: Date | null;
};

async function loadLocations(tenantId: string): Promise<LocationRow[]> {
  const snap = await tenantCol(tenantId, "locations")
    .orderBy("created_at", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as LocationDoc;
    return {
      id: d.id,
      name: data.name,
      addressLine1: data.address_line_1,
      addressLine2: data.address_line_2,
      city: data.city,
      state: data.state,
      postalCode: data.postal_code,
      country: data.country,
      phone: data.phone,
      timezone: data.timezone,
      isPrimary: data.is_primary,
      isActive: data.is_active,
      createdAt: toDate(data.created_at),
    };
  });
}

export default async function LocationsPage() {
  const ctx = await requireTenantContext("tenant_owner");
  let rows: LocationRow[] = [];
  let errorMsg: string | null = null;
  try {
    rows = await loadLocations(ctx.tenant.id);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Locations
        </h1>
        <span className="text-sm text-[var(--color-ink-muted)]">
          {rows.filter((r) => r.isActive).length} active
        </span>
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Each location has its own schedule, providers, and address. Mark one
        as primary — that&apos;s the default for new appointments.
      </p>

      {errorMsg && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {errorMsg}
        </div>
      )}

      <div className="mt-6">
        <LocationsView initialRows={rows} />
      </div>
    </div>
  );
}
