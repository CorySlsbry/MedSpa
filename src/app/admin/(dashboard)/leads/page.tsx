import Link from "next/link";
import { db, toDate } from "@/lib/firestore";
import type { LeadStatus, LeadInterest, LeadDoc } from "@/lib/firestore-types";

export const dynamic = "force-dynamic";

const ALL_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "demo_booked",
  "demo_done",
  "founding_spot_held",
  "closed_won",
  "closed_lost",
  "no_response",
];

const ALL_INTERESTS: LeadInterest[] = ["demo", "early_access", "pricing", "other"];

type Row = {
  id: string;
  contactName: string | null;
  contactEmail: string;
  clinicName: string | null;
  interest: LeadInterest;
  status: LeadStatus;
  createdAt: Date | null;
};

async function loadLeads(filters: {
  status?: LeadStatus;
  interest?: LeadInterest;
}): Promise<Row[]> {
  // Raised from 200 → 10000 so a full Jarvis prospect run (typically a
  // few thousand leads) renders without truncation. Above 10k we'd want
  // server-side pagination, but the typical sales pipeline is well
  // under that.
  let query = db()
    .collection("leads")
    .orderBy("created_at", "desc")
    .limit(10000) as FirebaseFirestore.Query;
  if (filters.status) query = query.where("status", "==", filters.status);
  if (filters.interest) query = query.where("interest", "==", filters.interest);
  const snap = await query.get();
  return snap.docs.map((d) => {
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
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; interest?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const status = ALL_STATUSES.includes(params.status as LeadStatus)
    ? (params.status as LeadStatus)
    : undefined;
  const interest = ALL_INTERESTS.includes(params.interest as LeadInterest)
    ? (params.interest as LeadInterest)
    : undefined;

  let rows: Row[];
  try {
    rows = await loadLeads({ status, interest });
  } catch (err) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6">
        <h1 className="font-display text-lg font-bold text-amber-900">Leads</h1>
        <p className="mt-2 text-sm text-amber-800">
          Firestore not reachable yet. See firestore/runbooks/01-firestore.md.
        </p>
        <pre className="mt-4 overflow-x-auto rounded bg-amber-100 px-3 py-2 text-xs text-amber-900">
          {err instanceof Error ? err.message : String(err)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Leads
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--color-ink-muted)]">
            {rows.length} {rows.length === 1 ? "lead" : "leads"}
          </span>
          <a
            href="/api/admin/leads/export"
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
          >
            Export CSV
          </a>
        </div>
      </div>

      <FilterBar currentStatus={status} currentInterest={interest} />

      <div className="mt-6 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            <tr>
              <th className="px-4 py-3">Clinic</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Interest</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-ink-muted)]">
                  No leads match those filters.
                </td>
              </tr>
            )}
            {rows.map((l) => (
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
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  {l.interest === "early_access" ? "Founding-25" : l.interest}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  {l.status.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                  {l.createdAt ? l.createdAt.toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterBar({
  currentStatus,
  currentInterest,
}: {
  currentStatus?: LeadStatus;
  currentInterest?: LeadInterest;
}) {
  function buildHref(params: { status?: LeadStatus; interest?: LeadInterest }): string {
    const sp = new URLSearchParams();
    if (params.status) sp.set("status", params.status);
    if (params.interest) sp.set("interest", params.interest);
    const qs = sp.toString();
    return `/admin/leads${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="mt-5 flex flex-wrap gap-2">
      <Link
        href={buildHref({ interest: currentInterest })}
        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
          !currentStatus
            ? "border-[var(--color-navy)] bg-[var(--color-navy)] text-[var(--color-cream)]"
            : "border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
        }`}
      >
        Any status
      </Link>
      {ALL_STATUSES.map((s) => (
        <Link
          key={s}
          href={buildHref({ status: s, interest: currentInterest })}
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            currentStatus === s
              ? "border-[var(--color-navy)] bg-[var(--color-navy)] text-[var(--color-cream)]"
              : "border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
          }`}
        >
          {s.replace(/_/g, " ")}
        </Link>
      ))}
    </div>
  );
}
