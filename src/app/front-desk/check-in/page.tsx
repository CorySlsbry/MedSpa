import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { loadAppointments } from "@/lib/tenant-views";
import TenantAppointmentsList from "@/components/TenantAppointmentsList";

export const metadata: Metadata = { title: "Front Desk · Check-in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Front-desk check-in page. Lists every appointment scheduled for today,
 * with a Check-in button on rows still in "scheduled" status. Posts to
 * /api/tenant/appointments/[id]/check-in to flip status to "checked_in"
 * and stamp checked_in_at.
 */
export default async function FrontDeskCheckInPage() {
  const ctx = await requireTenantContext("tenant_front_desk");

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const appointments = await loadAppointments({
    tenantId: ctx.tenant.id,
    fromMs: start.getTime(),
    toMs: end.getTime(),
  });

  const arrivals = appointments.filter((a) => a.status === "scheduled").length;
  const checkedIn = appointments.filter((a) => a.status === "checked_in").length;
  const completed = appointments.filter((a) => a.status === "completed").length;

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Front Desk · Check-in
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Check-in
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Today&apos;s arrivals at {ctx.tenant.name}. Tap <strong>Check in</strong> when
        the client arrives — the provider gets pinged and the visit moves to
        in-progress.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Tile label="Arriving" value={arrivals} accent="amber" />
        <Tile label="Checked in" value={checkedIn} accent="emerald" />
        <Tile label="Completed" value={completed} accent="navy" />
      </div>

      <div className="mt-8">
        <TenantAppointmentsList
          appointments={appointments}
          actorRole="tenant_front_desk"
          emptyMessage="No appointments scheduled for today yet. Walk-ins can be added from the Schedule page."
        />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "amber" | "emerald" | "navy";
}) {
  const palette = {
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
    navy: "border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-navy)]",
  }[accent];
  return (
    <div className={`rounded-xl border p-4 ${palette}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
    </div>
  );
}
