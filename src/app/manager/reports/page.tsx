import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import ReportsView from "@/components/owner/ReportsView";

export const metadata: Metadata = { title: "Manager · Reports", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Manager reports — same data as the owner reports page (operational
 * metrics: revenue, capacity, no-show rate, retention, ad-spend → bookings
 * over the last 30 days). Reads from the broadened
 * /api/owner/reports endpoint which now allows owner + manager.
 */
export default async function ManagerReportsPage() {
  await requireTenantContext("tenant_manager");
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Manager · Reports
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Operational reports
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Capacity utilization, no-show rate, retention, ad-spend → bookings.
        Last 30 days. Drill into a specific metric to see what&apos;s driving it.
      </p>
      <div className="mt-6">
        <ReportsView />
      </div>
    </div>
  );
}
