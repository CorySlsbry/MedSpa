import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import type { ClientDoc, ServiceDoc, WaitlistDoc } from "@/lib/firestore-types";
import WaitlistView from "@/components/owner/WaitlistView";
import type { WaitlistRow, ClientOption } from "@/app/owner/waitlist/page";

export const metadata: Metadata = { title: "Front Desk · Waitlist", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Front-desk waitlist — same UI + endpoints as the owner page (now allowed
 * for owner / manager / front-desk roles). Receptionists capture walk-ins
 * and notify the next person when a slot opens.
 */
export default async function FrontDeskWaitlistPage() {
  const ctx = await requireTenantContext("tenant_front_desk");

  const [waitlistSnap, clientsSnap, servicesSnap] = await Promise.all([
    tenantCol(ctx.tenant.id, "waitlist").orderBy("created_at", "desc").limit(500).get().catch(() => null),
    tenantCol(ctx.tenant.id, "clients").orderBy("created_at", "desc").limit(500).get().catch(() => null),
    tenantCol(ctx.tenant.id, "services").where("is_active", "==", true).orderBy("name", "asc").limit(200).get().catch(() => null),
  ]);

  const clientMap = new Map<string, string>();
  if (clientsSnap) {
    for (const d of clientsSnap.docs) clientMap.set(d.id, (d.data() as ClientDoc).full_name);
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

  const services = servicesSnap ? servicesSnap.docs.map((d) => (d.data() as ServiceDoc).name) : [];
  const active = rows.filter((r) => r.status === "active" || r.status === "notified");

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Front Desk · Waitlist
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            Waitlist
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            Capture walk-ins for sold-out slots and notify the next person when a
            booking cancels.
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
