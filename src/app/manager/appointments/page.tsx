import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { loadAppointments } from "@/lib/tenant-views";
import TenantAppointmentsList from "@/components/TenantAppointmentsList";

export const metadata: Metadata = { title: "Manager · Appointments", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ManagerAppointmentsPage() {
  const ctx = await requireTenantContext("tenant_manager");
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const today = await loadAppointments({
    tenantId: ctx.tenant.id,
    fromMs: start.getTime(),
    toMs: end.getTime(),
  });

  const cancelled = today.filter((a) => a.status === "cancelled").length;
  const noShow = today.filter((a) => a.status === "no_show").length;

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Manager · Appointments
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Today&apos;s appointments
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Triage cancellations + no-shows and send rebook nudges before noon.
        Cancellation today: {cancelled}. No-show: {noShow}.
      </p>
      <div className="mt-6">
        <TenantAppointmentsList
          appointments={today}
          actorRole="tenant_manager"
          emptyMessage="No appointments scheduled for today."
        />
      </div>
    </div>
  );
}
