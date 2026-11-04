import Link from "next/link";
import { db, toDate } from "@/lib/firestore";
import type { LeadStatus, LeadDoc } from "@/lib/firestore-types";

export const dynamic = "force-dynamic";

type DashboardData = {
  leadCount: number;
  newLeadCount: number;
  foundingSpotsRemaining: number;
  recentLeads: {
    id: string;
    contactName: string | null;
    contactEmail: string;
    clinicName: string | null;
    interest: string;
    status: LeadStatus;
    createdAt: Date | null;
  }[];
};

async function loadDashboard(): Promise<DashboardData> {
  const firestore = db();

  const [totalSnap, newSnap, foundingSnap, recentSnap] = await Promise.all([
    firestore.collection("leads").count().get(),
    firestore.collection("leads").where("status", "==", "new").count().get(),
    firestore
      .collection("deals")
      .where("is_founding_25", "==", true)
      .where("status", "in", ["open", "won", "paused"])
      .count()
      .get(),
    firestore.collection("leads").orderBy("created_at", "desc").limit(8).get(),
  ]);

  const recent = recentSnap.docs.map((d) => {
    const data = d.data() as LeadDoc;
    return {
      id: d.id,
      contactName: data.contact?.full_name ?? null,
      contactEmail: data.contact?.email ?? "",
      clinicName: data.company?.name ?? null,
      interest: data.interest,
      status: data.status,
      createdAt: toDate(data.created_at),
    };
  });

  return {
    leadCount: totalSnap.data().count,
    newLeadCount: newSnap.data().count,
    foundingSpotsRemaining: 25 - foundingSnap.data().count,
    recentLeads: recent,
  };
}

export default async function AdminDashboardPage() {
  let data: DashboardData;
  try {
    data = await loadDashboard();
  } catch (err) {
    return (
      <ErrorPanel
        title="Couldn't load the dashboard"
        message="Firestore isn't reachable yet. See firestore/runbooks/01-firestore.md."
        details={err instanceof Error ? err.message : String(err)}
      />
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Dashboard
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Sales pipeline + founding-25 funnel for Aesthera.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Kpi label="Total leads" value={data.leadCount} />
        <Kpi label="New (untouched)" value={data.newLeadCount} accent />
        <Kpi
          label="Founding-25 spots remaining"
          value={data.foundingSpotsRemaining}
          accent={data.foundingSpotsRemaining > 0}
        />
      </div>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
            Recent leads
          </h2>
          <Link
            href="/admin/leads"
            className="text-sm font-semibold text-[var(--color-teal)] hover:underline"
          >
            All leads →
          </Link>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-3">Clinic</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Interest</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {data.recentLeads.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-ink-muted)]">
                    No leads yet. The first /api/demo submission will land here.
                  </td>
                </tr>
              )}
              {data.recentLeads.map((l) => (
                <tr key={l.id} className="hover:bg-[var(--color-cream-deep)]/30">
                  <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">
                    <Link href={`/admin/leads/${l.id}`} className="hover:underline">
                      {l.clinicName || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-ink-soft)]">
                    <div>{l.contactName || "—"}</div>
                    <div className="text-xs text-[var(--color-ink-muted)]">{l.contactEmail}</div>
                  </td>
                  <td className="px-4 py-3">
                    <InterestBadge value={l.interest} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={l.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                    {l.createdAt ? formatRelative(l.createdAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        accent
          ? "border-[var(--color-gold)] bg-[var(--color-paper)] shadow-[0_20px_60px_-30px_rgba(185,143,66,0.4)]"
          : "border-[var(--color-line)] bg-[var(--color-paper)]"
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-bold text-[var(--color-navy)]">
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: LeadStatus }) {
  const map: Record<LeadStatus, string> = {
    new: "bg-[var(--color-gold)]/15 text-[var(--color-gold-deep)]",
    contacted: "bg-[var(--color-teal)]/15 text-[var(--color-teal-deep)]",
    qualified: "bg-[var(--color-teal)]/20 text-[var(--color-teal-deep)]",
    demo_booked: "bg-[var(--color-teal)]/25 text-[var(--color-teal-deep)]",
    demo_done: "bg-[var(--color-teal)]/30 text-[var(--color-teal-deep)]",
    founding_spot_held: "bg-[var(--color-gold)]/30 text-[var(--color-gold-deep)]",
    closed_won: "bg-emerald-100 text-emerald-800",
    closed_lost: "bg-rose-100 text-rose-800",
    no_response: "bg-gray-100 text-gray-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${map[status]}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function InterestBadge({ value }: { value: string }) {
  const label =
    value === "early_access"
      ? "Founding-25"
      : value === "demo"
        ? "Demo"
        : value === "pricing"
          ? "Pricing"
          : value;
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--color-line)] bg-[var(--color-cream-deep)] px-2.5 py-1 text-xs font-semibold text-[var(--color-ink-soft)]">
      {label}
    </span>
  );
}

function formatRelative(d: Date): string {
  const seconds = (Date.now() - d.getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 30 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return d.toLocaleDateString();
}

function ErrorPanel({
  title,
  message,
  details,
}: {
  title: string;
  message: string;
  details?: string;
}) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-6">
      <h2 className="font-display text-lg font-bold text-amber-900">{title}</h2>
      <p className="mt-2 text-sm text-amber-800">{message}</p>
      {details && (
        <pre className="mt-4 overflow-x-auto rounded bg-amber-100 px-3 py-2 text-xs text-amber-900">
          {details}
        </pre>
      )}
    </div>
  );
}
