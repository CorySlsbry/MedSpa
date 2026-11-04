import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import type { ChartDoc, ChartStatus, ClientDoc, AppointmentDoc } from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Provider · Charts",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type ChartRow = {
  id: string;
  appointmentId: string;
  service: string;
  startsAt: Date | null;
  clientName: string;
  clientEmail: string;
  status: ChartStatus;
  signedAt: Date | null;
  updatedAt: Date | null;
};

async function loadCharts(tenantId: string, providerUid: string): Promise<ChartRow[]> {
  // Pull recent charts authored by this provider
  const snap = await tenantCol(tenantId, "charts")
    .where("provider_id", "==", providerUid)
    .orderBy("updated_at", "desc")
    .limit(50)
    .get()
    .catch(() => null);
  if (!snap) return [];

  // Fetch related appointments + clients in parallel
  const charts = snap.docs.map((d) => d.data() as ChartDoc & { __id: string });
  const apptIds = Array.from(new Set(snap.docs.map((d) => d.id)));
  const cliIds = Array.from(new Set(charts.map((c) => c.client_id).filter(Boolean)));

  const [apptDocs, cliDocs] = await Promise.all([
    Promise.all(
      apptIds.map((id) =>
        tenantCol(tenantId, "appointments").doc(id).get().catch(() => null),
      ),
    ),
    Promise.all(
      cliIds.map((id) =>
        tenantCol(tenantId, "clients").doc(id).get().catch(() => null),
      ),
    ),
  ]);
  const apptById = new Map<string, AppointmentDoc>();
  for (const a of apptDocs) {
    if (a && a.exists) apptById.set(a.id, a.data() as AppointmentDoc);
  }
  const cliById = new Map<string, ClientDoc>();
  for (const c of cliDocs) {
    if (c && c.exists) cliById.set(c.id, c.data() as ClientDoc);
  }

  return snap.docs.map((d) => {
    const data = d.data() as ChartDoc;
    const appt = apptById.get(d.id);
    const cli = cliById.get(data.client_id);
    return {
      id: d.id,
      appointmentId: d.id,
      service: appt?.service ?? "—",
      startsAt: toDate(appt?.starts_at ?? null),
      clientName: cli?.full_name ?? "Unknown",
      clientEmail: cli?.email ?? "",
      status: data.status,
      signedAt: toDate(data.signed_at),
      updatedAt: toDate(data.updated_at),
    };
  });
}

export default async function ChartsListPage() {
  const ctx = await requireTenantContext("tenant_provider");
  const rows = await loadCharts(ctx.tenant.id, ctx.user.firebaseUid);

  const drafts = rows.filter((r) => r.status === "draft");
  const signed = rows.filter((r) => r.status === "signed");

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Charts
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Your authored SOAP charts. Drafts are open for editing; signed
        charts are immutable.
      </p>

      {drafts.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
            Drafts ({drafts.length})
          </h2>
          <ChartTable rows={drafts} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
          {signed.length === 0 ? "No signed charts yet" : `Signed (${signed.length})`}
        </h2>
        {signed.length > 0 && <ChartTable rows={signed} />}
      </section>
    </div>
  );
}

function ChartTable({ rows }: { rows: ChartRow[] }) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          <tr>
            <th className="px-4 py-3">Visit</th>
            <th className="px-4 py-3">Client</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Last touched</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-[var(--color-cream-deep)]/30">
              <td className="px-4 py-3">
                <Link
                  href={`/provider/charts/${r.appointmentId}`}
                  className="font-semibold text-[var(--color-navy)] hover:underline"
                >
                  {r.service}
                </Link>
                <div className="text-[10px] text-[var(--color-ink-muted)]">
                  {r.startsAt?.toLocaleString() ?? "—"}
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                {r.clientName}
                <div className="text-[10px] text-[var(--color-ink-muted)]">{r.clientEmail}</div>
              </td>
              <td className="px-4 py-3 text-xs">
                {r.status === "signed" ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
                    signed
                  </span>
                ) : (
                  <span className="rounded-full bg-[var(--color-gold)]/15 px-2 py-0.5 font-semibold text-[var(--color-gold-deep)]">
                    draft
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                {(r.signedAt ?? r.updatedAt)?.toLocaleDateString() ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
