import { db, toDate } from "@/lib/firestore";
import type { DealDoc, DealStatus } from "@/lib/firestore-types";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  clinicName: string | null;
  isFounding25: boolean;
  foundingSpotNumber: number | null;
  status: DealStatus;
  monthlyValueCents: number | null;
  expectedCloseDate: Date | null;
  createdAt: Date | null;
};

async function loadDeals(): Promise<Row[]> {
  const snap = await db()
    .collection("deals")
    .orderBy("created_at", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as DealDoc;
    return {
      id: d.id,
      name: data.name,
      clinicName: data.company_name,
      isFounding25: data.is_founding_25,
      foundingSpotNumber: data.founding_spot_number,
      status: data.status,
      monthlyValueCents: data.monthly_value_cents,
      expectedCloseDate: toDate(data.expected_close_date),
      createdAt: toDate(data.created_at),
    };
  });
}

export default async function DealsPage() {
  let rows: Row[];
  try {
    rows = await loadDeals();
  } catch (err) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        Firestore error: {err instanceof Error ? err.message : String(err)}
      </div>
    );
  }

  const foundingTaken = rows.filter((d) => d.isFounding25 && d.status !== "lost").length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Deals
        </h1>
        <span className="text-sm text-[var(--color-ink-muted)]">
          {rows.length} · {foundingTaken}/25 founding spots
        </span>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Clinic</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Founding spot</th>
              <th className="px-4 py-3">MRR</th>
              <th className="px-4 py-3">Expected close</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[var(--color-ink-muted)]">
                  No deals yet.
                </td>
              </tr>
            )}
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-[var(--color-cream-deep)]/30">
                <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">{d.name}</td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">{d.clinicName || "—"}</td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">{d.status}</td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  {d.isFounding25 ? `#${d.foundingSpotNumber ?? "?"} of 25` : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  {d.monthlyValueCents != null
                    ? `$${(d.monthlyValueCents / 100).toFixed(0)}/mo`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                  {d.expectedCloseDate ? d.expectedCloseDate.toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
