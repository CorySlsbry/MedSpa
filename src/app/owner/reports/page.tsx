import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import ReportsView from "@/components/owner/ReportsView";

export const metadata: Metadata = {
  title: "Owner · Reports",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  await requireTenantContext("tenant_owner");
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Reports
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Revenue, bookings, retention, and marketing performance. All data is live.
      </p>
      <div className="mt-6">
        <ReportsView />
      </div>
    </div>
  );
}
