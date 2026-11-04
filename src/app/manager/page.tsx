import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { Timestamp } from "firebase-admin/firestore";

export const metadata: Metadata = {
  title: "Manager · Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Manager dashboard — operational summary card for the GM/operations lead.
 * Surfaces what they need to make Monday-morning decisions: today's volume,
 * complaint queue, team coverage, low-stock alerts.
 *
 * Reads tenant data only — never another tenant's. Mutating actions live
 * on the per-section pages (Team, Inbox, Complaints, etc.) under /manager/*.
 */
export default async function ManagerDashboardPage() {
  const ctx = await requireTenantContext("tenant_manager");

  // Today's appointments — count by status
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const apptSnap = await tenantCol(ctx.tenant.id, "appointments")
    .where("starts_at", ">=", Timestamp.fromDate(startOfToday))
    .where("starts_at", "<", Timestamp.fromDate(endOfToday))
    .limit(500)
    .get()
    .catch(() => null);
  const todayAppts = apptSnap?.docs.map((d) => d.data()) ?? [];
  const counts = {
    total: todayAppts.length,
    completed: todayAppts.filter((a) => a.status === "completed").length,
    cancelled: todayAppts.filter((a) => a.status === "cancelled").length,
    no_show: todayAppts.filter((a) => a.status === "no_show").length,
  };

  // Provider count — drives "team" stat tile
  const providerSnap = await tenantCol(ctx.tenant.id, "providers")
    .where("is_active", "==", true)
    .limit(100)
    .get()
    .catch(() => null);
  const activeProviders = providerSnap?.size ?? 0;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        {ctx.tenant.name}
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Operations dashboard — Monday-morning view of how the clinic is running.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Today's appointments"
          value={String(counts.total)}
          sub={`${counts.completed} completed`}
          href="/manager/appointments"
        />
        <StatCard
          label="No-shows today"
          value={String(counts.no_show)}
          sub={counts.no_show === 0 ? "Clean board" : "Follow up before noon"}
          href="/manager/appointments"
        />
        <StatCard
          label="Cancellations today"
          value={String(counts.cancelled)}
          sub="Send a rebook nudge"
          href="/manager/inbox"
        />
        <StatCard
          label="Active providers"
          value={String(activeProviders)}
          sub="On schedule today"
          href="/manager/team"
        />
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <SectionCard
          eyebrow="Team"
          title="Manage providers + schedule"
          body="Add or remove providers, adjust their availability, see who's on call."
          href="/manager/team"
          cta="Open team"
        />
        <SectionCard
          eyebrow="Complaints"
          title="Triage what came in"
          body="Customer-service tickets land here — assign, respond, close. The Manager AI can draft replies."
          href="/manager/complaints"
          cta="Open complaints"
        />
        <SectionCard
          eyebrow="Inventory"
          title="Low-stock + reorder list"
          body="Products under reorder threshold flagged here. Track usage by service."
          href="/manager/inventory"
          cta="Open inventory"
        />
        <SectionCard
          eyebrow="Reports"
          title="Operational metrics"
          body="Capacity, no-show rate, retention, ad spend → bookings. Last 30 days."
          href="/manager/reports"
          cta="Open reports"
        />
      </div>

      <div className="mt-12 rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 p-6">
        <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
          Tip
        </div>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          Click <strong>Ask Aesthera</strong> in the bottom-right to ask the
          Manager AI things like &quot;Which providers had the most no-shows last
          month?&quot; or &quot;Draft a response to the latest complaint.&quot;
        </p>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 transition hover:border-[var(--color-gold)]"
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-bold text-[var(--color-navy)]">
        {value}
      </div>
      <div className="mt-1 text-xs text-[var(--color-ink-soft)]">{sub}</div>
    </Link>
  );
}

function SectionCard({
  eyebrow,
  title,
  body,
  href,
  cta,
}: {
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
      <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
        {eyebrow}
      </div>
      <h3 className="mt-2 font-display text-lg font-bold text-[var(--color-navy)]">
        {title}
      </h3>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{body}</p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-teal)] hover:underline"
      >
        {cta} →
      </Link>
    </div>
  );
}
