import type { Metadata } from "next";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import AppointmentsView from "@/components/owner/AppointmentsView";
import type {
  AppointmentDoc,
  AppointmentStatus,
  ClientDoc,
  LocationDoc,
  ProviderDoc,
  ServiceDoc,
} from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Owner · Appointments",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type ApptRow = {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
  status: AppointmentStatus;
  service: string;
  providerId: string;
  providerName: string | null;
  locationId: string;
  locationName: string | null;
  clientId: string;
  clientName: string | null;
  notes: string | null;
};

export type ProviderOption = {
  id: string;
  name: string;
  schedulingColor: string | null;
};
export type ClientOption = { id: string; label: string };
export type ServiceOption = { id: string; name: string; durationMinutes: number };
export type LocationOption2 = { id: string; name: string; isPrimary: boolean };

async function loadOptions(tenantId: string) {
  const [locSnap, provSnap, svcSnap, cliSnap] = await Promise.all([
    tenantCol(tenantId, "locations").where("is_active", "==", true).orderBy("created_at", "asc").limit(50).get(),
    tenantCol(tenantId, "providers").where("is_active", "==", true).orderBy("full_name", "asc").limit(100).get(),
    tenantCol(tenantId, "services").where("is_active", "==", true).orderBy("name", "asc").limit(200).get(),
    tenantCol(tenantId, "clients").orderBy("created_at", "desc").limit(500).get(),
  ]);
  const locations: LocationOption2[] = locSnap.docs.map((d) => ({
    id: d.id,
    name: (d.data() as LocationDoc).name,
    isPrimary: (d.data() as LocationDoc).is_primary,
  }));
  const providers: ProviderOption[] = provSnap.docs.map((d) => ({
    id: d.id,
    name: (d.data() as ProviderDoc).full_name,
    schedulingColor: (d.data() as ProviderDoc).scheduling_color,
  }));
  const services: ServiceOption[] = svcSnap.docs.map((d) => ({
    id: d.id,
    name: (d.data() as ServiceDoc).name,
    durationMinutes: (d.data() as ServiceDoc).duration_minutes,
  }));
  const clients: ClientOption[] = cliSnap.docs.map((d) => {
    const data = d.data() as ClientDoc;
    return { id: d.id, label: `${data.full_name} · ${data.email}` };
  });
  return { locations, providers, services, clients };
}

async function loadUpcoming(
  tenantId: string,
  providerById: Map<string, string>,
  locById: Map<string, string>,
  clientById: Map<string, string>,
): Promise<ApptRow[]> {
  const startWindow = new Date(Date.now() - 24 * 60 * 60 * 1000); // include today
  const endWindow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const snap = await tenantCol(tenantId, "appointments")
    .where("starts_at", ">=", Timestamp.fromDate(startWindow))
    .where("starts_at", "<=", Timestamp.fromDate(endWindow))
    .orderBy("starts_at", "asc")
    .limit(200)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const data = d.data() as AppointmentDoc;
    return {
      id: d.id,
      startsAt: toDate(data.starts_at),
      endsAt: toDate(data.ends_at),
      status: data.status,
      service: data.service,
      providerId: data.provider_id,
      providerName: providerById.get(data.provider_id) ?? null,
      locationId: data.location_id,
      locationName: locById.get(data.location_id) ?? null,
      clientId: data.client_id,
      clientName: clientById.get(data.client_id) ?? null,
      notes: data.notes,
    };
  });
}

export default async function AppointmentsPage() {
  const ctx = await requireTenantContext("tenant_owner");
  let opts: Awaited<ReturnType<typeof loadOptions>>;
  let appts: ApptRow[] = [];
  let errorMsg: string | null = null;
  try {
    opts = await loadOptions(ctx.tenant.id);
    const providerById = new Map(opts.providers.map((p) => [p.id, p.name]));
    const locById = new Map(opts.locations.map((l) => [l.id, l.name]));
    const clientById = new Map(opts.clients.map((c) => [c.id, c.label.split(" · ")[0]]));
    appts = await loadUpcoming(ctx.tenant.id, providerById, locById, clientById);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    opts = { locations: [], providers: [], services: [], clients: [] };
  }

  const setupNeeded =
    opts.locations.length === 0 ||
    opts.providers.length === 0 ||
    opts.services.length === 0 ||
    opts.clients.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Appointments
        </h1>
        <span className="text-sm text-[var(--color-ink-muted)]">
          {appts.length} in next 30 days
        </span>
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Schedule appointments by picking a client, provider, location, and
        service. End time is computed from the service duration.
      </p>

      {errorMsg && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {errorMsg}
        </div>
      )}

      {setupNeeded && !errorMsg && (
        <div className="mt-4 rounded-lg border-l-4 border-[var(--color-gold)] bg-[var(--color-gold)]/10 px-4 py-3 text-sm text-[var(--color-ink)]">
          <strong>Setup needed.</strong> Before you can schedule, add at least
          one location, provider, service, and client.
        </div>
      )}

      <div className="mt-6">
        <AppointmentsView
          initialRows={appts}
          locations={opts.locations}
          providers={opts.providers}
          services={opts.services}
          clients={opts.clients}
        />
      </div>
    </div>
  );
}
