import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { loadAppointments } from "@/lib/tenant-views";
import TenantAppointmentsList from "@/components/TenantAppointmentsList";

export const metadata: Metadata = { title: "Front Desk · Schedule", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Front-desk schedule — next 7 days of appointments across every provider.
 * Read-only at this layer; provider-side handles clinical detail. Uses the
 * shared TenantAppointmentsList component.
 */
export default async function FrontDeskSchedulePage() {
  const ctx = await requireTenantContext("tenant_front_desk");
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const appointments = await loadAppointments({
    tenantId: ctx.tenant.id,
    fromMs: start.getTime(),
    toMs: end.getTime(),
    limit: 500,
  });

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Front Desk · Schedule
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Schedule — next 7 days
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Every booking across every provider for the next week. Sorted by time.
      </p>
      <div className="mt-6">
        <TenantAppointmentsList
          appointments={appointments}
          actorRole="tenant_front_desk"
          emptyMessage="No bookings on the calendar in the next 7 days."
        />
      </div>
    </div>
  );
}
