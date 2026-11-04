import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { Timestamp } from "firebase-admin/firestore";

export const metadata: Metadata = {
  title: "Front Desk · Today",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Front Desk dashboard — what the receptionist sees when they walk in.
 * Today's schedule (sorted by time), check-in queue, the inbox, and the
 * waitlist. NO financials, NO HR, NO clinical charting — those live on
 * higher-privilege portals.
 */
export default async function FrontDeskTodayPage() {
  const ctx = await requireTenantContext("tenant_front_desk");

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const apptSnap = await tenantCol(ctx.tenant.id, "appointments")
    .where("starts_at", ">=", Timestamp.fromDate(startOfToday))
    .where("starts_at", "<", Timestamp.fromDate(endOfToday))
    .orderBy("starts_at", "asc")
    .limit(200)
    .get()
    .catch(() => null);

  const todayAppts = (apptSnap?.docs ?? []).map((d) => {
    const a = d.data() as {
      starts_at: Timestamp;
      service?: string;
      status: string;
      client_id: string;
    };
    return {
      id: d.id,
      time: a.starts_at?.toDate().toISOString().slice(11, 16) ?? "—",
      service: a.service ?? "Visit",
      status: a.status,
      client_id: a.client_id,
    };
  });

  const checkedIn = todayAppts.filter((a) => a.status === "checked_in").length;
  const arriving = todayAppts.filter((a) => a.status === "scheduled").length;
  const completed = todayAppts.filter((a) => a.status === "completed").length;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Today at {ctx.tenant.name}
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Front desk view — schedule, check-ins, and the message inbox. Tap a
        client to check them in.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatTile label="Arriving" value={String(arriving)} accent="amber" />
        <StatTile label="Checked in" value={String(checkedIn)} accent="emerald" />
        <StatTile label="Completed" value={String(completed)} accent="navy" />
      </div>

      <section className="mt-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
            Today&apos;s schedule
          </h2>
          <Link
            href="/front-desk/schedule"
            className="text-xs font-semibold text-[var(--color-teal)] hover:underline"
          >
            Full schedule →
          </Link>
        </div>
        {todayAppts.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
            No appointments scheduled for today yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--color-line)]">
            {todayAppts.slice(0, 12).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs font-semibold text-[var(--color-ink-muted)]">
                    {a.time}
                  </div>
                  <div className="text-sm font-semibold text-[var(--color-navy)]">
                    {a.service}
                  </div>
                </div>
                <StatusPill status={a.status} />
                <Link
                  href={`/front-desk/check-in?appt=${a.id}`}
                  className="rounded-md border border-[var(--color-line)] bg-[var(--color-cream-deep)] px-3 py-1.5 text-xs font-semibold text-[var(--color-navy)] hover:bg-[var(--color-cream)]"
                >
                  {a.status === "scheduled" ? "Check in" : "Open"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <ActionCard
          title="Inbox"
          body="Reply to client messages — texts and emails land here."
          href="/front-desk/inbox"
          cta="Open inbox"
        />
        <ActionCard
          title="Waitlist"
          body="Add a walk-in to the waitlist or notify next in line when a slot opens."
          href="/front-desk/waitlist"
          cta="Open waitlist"
        />
      </div>

      <div className="mt-12 rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 p-6">
        <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
          Tip
        </div>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          The <strong>Ask Aesthera</strong> button (bottom-right) is your front-desk
          assistant. Try &quot;Find Sarah&apos;s last visit&quot; or &quot;Draft a friendly
          rebook reminder for the 2pm cancellation.&quot;
        </p>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "amber" | "emerald" | "navy";
}) {
  const palette = {
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
    navy: "border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-navy)]",
  }[accent];
  return (
    <div className={`rounded-xl border p-5 ${palette}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-bold">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: "bg-amber-100 text-amber-800",
    checked_in: "bg-emerald-100 text-emerald-800",
    in_service: "bg-sky-100 text-sky-800",
    completed: "bg-[var(--color-cream-deep)] text-[var(--color-ink-muted)]",
    cancelled: "bg-rose-100 text-rose-800",
    no_show: "bg-rose-100 text-rose-800",
  };
  const cls = map[status] ?? "bg-[var(--color-cream-deep)] text-[var(--color-ink-muted)]";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ActionCard({
  title,
  body,
  href,
  cta,
}: {
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
      <h3 className="font-display text-lg font-bold text-[var(--color-navy)]">
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
