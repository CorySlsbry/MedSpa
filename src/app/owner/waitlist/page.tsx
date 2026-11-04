import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import type { ClientDoc, ServiceDoc, WaitlistDoc } from "@/lib/firestore-types";
import WaitlistView from "@/components/owner/WaitlistView";

export const metadata: Metadata = {
  title: "Owner · Waitlist",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type WaitlistRow = {
  id: string;
  clientId: string;
  clientName: string | null;
  serviceName: string;
  notes: string | null;
  preferredDays: number[];
  status: WaitlistDoc["status"];
  notifiedAt: Date | null;
  createdAt: Date | null;
};

export type ClientOption = { id: string; label: string };

export default async function WaitlistPage() {
  const ctx = await requireTenantContext("tenant_owner");

  const [waitlistSnap, clientsSnap, servicesSnap] = await Promise.all([
    tenantCol(ctx.tenant.id, "waitlist")
      .orderBy("created_at", "desc")
      .limit(500)
      .get()
      .catch(() => null),
    tenantCol(ctx.tenant.id, "clients")
      .orderBy("created_at", "desc")
      .limit(500)
      .get()
      .catch(() => null),
    tenantCol(ctx.tenant.id, "services")
      .where("is_active", "==", true)
      .orderBy("name", "asc")
      .limit(200)
      .get()
      .catch(() => null),
  ]);

  const clientMap = new Map<string, string>();
  if (clientsSnap) {
    for (const d of clientsSnap.docs) {
      clientMap.set(d.id, (d.data() as ClientDoc).full_name);
    }
  }

  const rows: WaitlistRow[] = waitlistSnap
    ? waitlistSnap.docs.map((d) => {
        const w = d.data() as WaitlistDoc;
        return {
          id: d.id,
          clientId: w.client_id,
          clientName: clientMap.get(w.client_id) ?? null,
          serviceName: w.service_name,
          notes: w.notes,
          preferredDays: w.preferred_days,
          status: w.status,
          notifiedAt: toDate(w.notified_at),
          createdAt: toDate(w.created_at),
        };
      })
    : [];

  const clients: ClientOption[] = clientsSnap
    ? clientsSnap.docs.map((d) => {
        const c = d.data() as ClientDoc;
        return { id: d.id, label: `${c.full_name} · ${c.email}` };
      })
    : [];

  const services = servicesSnap
    ? servicesSnap.docs.map((d) => (d.data() as ServiceDoc).name)
    : [];

  const active = rows.filter(
    (r) => r.status === "active" || r.status === "notified",
  );

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            Waitlist
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            Capture demand for popular providers + sold-out slots. Notify clients
            when an opening pops up.
          </p>
        </div>
        <span className="rounded-full bg-[var(--color-paper)] px-3 py-1 text-xs font-semibold text-[var(--color-ink-soft)] shadow-sm">
          {active.length} active
        </span>
      </div>

      <div className="mt-6">
        <WaitlistView initialRows={rows} clients={clients} services={services} />
      </div>
    </div>
  );
}
