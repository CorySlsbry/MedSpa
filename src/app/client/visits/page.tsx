import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import type {
  AppointmentDoc,
  AppointmentStatus,
  ClientDoc,
} from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "My visits",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  checked_in: "Checked in",
  in_progress: "In progress",
  completed: "Completed",
  no_show: "No show",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  scheduled: "bg-[var(--color-gold)]/15 text-[var(--color-gold-deep)]",
  checked_in: "bg-[var(--color-teal)]/15 text-[var(--color-teal-deep)]",
  in_progress: "bg-[var(--color-teal)]/30 text-[var(--color-teal-deep)]",
  completed: "bg-emerald-100 text-emerald-800",
  no_show: "bg-rose-100 text-rose-800",
  cancelled: "bg-gray-100 text-gray-700",
};

export default async function ClientVisitsPage() {
  const ctx = await requireTenantContext("tenant_client");

  // Resolve the client doc by their email
  const cliQuery = await tenantCol(ctx.tenant.id, "clients")
    .where("email", "==", ctx.user.email)
    .limit(1)
    .get()
    .catch(() => null);
  if (!cliQuery || cliQuery.empty) {
    return <NoRecord ownerEmail={ctx.tenant.owner_email} />;
  }
  const clientId = cliQuery.docs[0].id;
  const client = cliQuery.docs[0].data() as ClientDoc;

  const apptSnap = await tenantCol(ctx.tenant.id, "appointments")
    .where("client_id", "==", clientId)
    .orderBy("starts_at", "desc")
    .limit(100)
    .get();

  const visits = apptSnap.docs.map((d) => {
    const data = d.data() as AppointmentDoc;
    return {
      id: d.id,
      service: data.service,
      startsAt: toDate(data.starts_at),
      status: data.status,
      hasChart: !!data.chart_id,
    };
  });
  const upcoming = visits.filter(
    (v) => v.startsAt && v.startsAt.getTime() > Date.now() && v.status !== "cancelled",
  );
  const past = visits.filter(
    (v) => !v.startsAt || v.startsAt.getTime() <= Date.now() || v.status === "cancelled",
  );

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            My visits
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            Hi {client.preferred_name ?? client.full_name.split(" ")[0]} — your
            history with {ctx.tenant.name}.
          </p>
        </div>
        <a
          href={`/embed/${ctx.tenant.id}/book`}
          className="btn btn-gold"
        >
          Book a visit
        </a>
      </div>

      {upcoming.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
            Upcoming
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {upcoming.map((v) => (
              <div
                key={v.id}
                className="rounded-2xl border border-[var(--color-gold)] bg-[var(--color-paper)] p-5 shadow-sm"
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
                  {STATUS_LABEL[v.status]}
                </div>
                <div className="mt-1 font-display text-lg font-bold text-[var(--color-navy)]">
                  {v.service}
                </div>
                <div className="mt-1 text-sm text-[var(--color-ink-soft)]">
                  {v.startsAt?.toLocaleString() ?? "—"}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
          History
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
          {past.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
              No past visits.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {past.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--color-ink)]">{v.service}</div>
                    <div className="text-xs text-[var(--color-ink-muted)]">
                      {v.startsAt?.toLocaleString() ?? "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {v.hasChart && v.status === "completed" && (
                      <span className="rounded-full bg-[var(--color-teal)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-teal-deep)]">
                        Charted
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_COLOR[v.status]}`}
                    >
                      {STATUS_LABEL[v.status]}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="mt-6 text-[11px] text-[var(--color-ink-muted)]">
        Need a copy of a chart or receipt? Email{" "}
        <Link
          href={`mailto:${ctx.tenant.owner_email}`}
          className="font-semibold underline"
        >
          {ctx.tenant.owner_email}
        </Link>
        .
      </p>
    </div>
  );
}

function NoRecord({ ownerEmail }: { ownerEmail: string }) {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)]">
        My visits
      </h1>
      <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        Your client record isn&apos;t fully set up yet. The clinic will finish
        your profile shortly. If something looks off, message{" "}
        <a href={`mailto:${ownerEmail}`} className="underline">
          {ownerEmail}
        </a>
        .
      </div>
    </div>
  );
}
