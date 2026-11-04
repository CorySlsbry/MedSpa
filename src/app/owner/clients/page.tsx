import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import ClientsView from "@/components/owner/ClientsView";
import type { ClientDoc, LocationDoc } from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Owner · Clients",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type ClientRow = {
  id: string;
  email: string;
  fullName: string;
  preferredName: string | null;
  phone: string | null;
  defaultLocationId: string | null;
  tags: string[];
  emailConsent: boolean;
  smsConsent: boolean;
  createdAt: Date | null;
};

export type LocationOption = { id: string; name: string };

async function loadClients(tenantId: string): Promise<ClientRow[]> {
  const snap = await tenantCol(tenantId, "clients")
    .orderBy("created_at", "desc")
    .limit(500)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as ClientDoc;
    return {
      id: d.id,
      email: data.email,
      fullName: data.full_name,
      preferredName: data.preferred_name,
      phone: data.phone,
      defaultLocationId: data.default_location_id,
      tags: data.tags || [],
      emailConsent: data.email_consent,
      smsConsent: data.sms_consent,
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

export default async function ClientsPage() {
  const ctx = await requireTenantContext("tenant_owner");
  let rows: ClientRow[] = [];
  let locations: LocationOption[] = [];
  let errorMsg: string | null = null;
  try {
    [rows, locations] = await Promise.all([
      loadClients(ctx.tenant.id),
      loadLocationOptions(ctx.tenant.id),
    ]);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Clients
        </h1>
        <span className="text-sm text-[var(--color-ink-muted)]">
          {rows.length} total
        </span>
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Your clinic&apos;s patients. Add manually, bulk-import via CSV, or let
        the embed booking widget create them automatically when clients book.
      </p>

      {errorMsg && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {errorMsg}
        </div>
      )}

      <div className="mt-6">
        <ClientsView initialRows={rows} locations={locations} />
      </div>
    </div>
  );
}
