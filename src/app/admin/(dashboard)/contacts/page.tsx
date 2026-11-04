import { db, toDate } from "@/lib/firestore";
import type { ContactDoc } from "@/lib/firestore-types";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  role: string | null;
  clinicName: string | null;
  doNotContact: boolean;
  createdAt: Date | null;
};

async function loadContacts(): Promise<Row[]> {
  const snap = await db()
    .collection("contacts")
    .orderBy("created_at", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as ContactDoc;
    return {
      id: d.id,
      email: data.email,
      fullName: data.full_name,
      phone: data.phone,
      role: data.role,
      clinicName: data.company_name,
      doNotContact: data.do_not_contact,
      createdAt: toDate(data.created_at),
    };
  });
}

export default async function ContactsPage() {
  let rows: Row[];
  try {
    rows = await loadContacts();
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
          Contacts
        </h1>
        <span className="text-sm text-[var(--color-ink-muted)]">
          {rows.length} {rows.length === 1 ? "contact" : "contacts"}
        </span>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Clinic</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[var(--color-ink-muted)]">
                  No contacts yet.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-[var(--color-cream-deep)]/30">
                <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">
                  {c.fullName || "—"}
                  {c.doNotContact && (
                    <span className="ml-2 inline-flex rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-800">
                      DNC
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  <a href={`mailto:${c.email}`} className="hover:underline">
                    {c.email}
                  </a>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="hover:underline">
                      {c.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">{c.clinicName || "—"}</td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">{c.role || "—"}</td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                  {c.createdAt ? c.createdAt.toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
