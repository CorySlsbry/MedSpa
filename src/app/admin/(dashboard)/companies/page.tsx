import { db, toDate } from "@/lib/firestore";
import type { CompanyDoc } from "@/lib/firestore-types";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  type: string;
  locationsCount: string | null;
  contactCount: number;
  leadCount: number;
  createdAt: Date | null;
};

async function loadCompanies(): Promise<Row[]> {
  const snap = await db()
    .collection("companies")
    .orderBy("created_at", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as CompanyDoc;
    return {
      id: d.id,
      name: data.name,
      type: data.type,
      locationsCount: data.locations_count,
      contactCount: data.contact_count ?? 0,
      leadCount: data.lead_count ?? 0,
      createdAt: toDate(data.created_at),
    };
  });
}

export default async function CompaniesPage() {
  let rows: Row[];
  try {
    rows = await loadCompanies();
  } catch (err) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        Firestore error: {err instanceof Error ? err.message : String(err)}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Companies
        </h1>
        <span className="text-sm text-[var(--color-ink-muted)]">{rows.length}</span>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Locations</th>
              <th className="px-4 py-3">Contacts</th>
              <th className="px-4 py-3">Leads</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-ink-muted)]">
                  No companies yet.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-[var(--color-cream-deep)]/30">
                <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">{c.name}</td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  {c.type.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  {c.locationsCount || "—"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">{c.contactCount}</td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">{c.leadCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
