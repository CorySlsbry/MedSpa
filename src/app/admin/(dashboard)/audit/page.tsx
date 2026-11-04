import { db, toDate } from "@/lib/firestore";
import type { AuditAction, AuditLogDoc } from "@/lib/firestore-types";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  actorEmail: string | null;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  createdAt: Date | null;
};

async function loadAudit(): Promise<Row[]> {
  const snap = await db()
    .collection("audit_log")
    .orderBy("created_at", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as AuditLogDoc;
    return {
      id: d.id,
      actorEmail: data.actor_email,
      action: data.action,
      targetType: data.target_type,
      targetId: data.target_id,
      ip: data.ip,
      createdAt: toDate(data.created_at),
    };
  });
}

export default async function AuditPage() {
  let rows: Row[];
  try {
    rows = await loadAudit();
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
          Audit log
        </h1>
        <span className="text-sm text-[var(--color-ink-muted)]">
          Last {rows.length} entries · append-only
        </span>
      </div>

      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Every CRM mutation, sign-in attempt, and admin action lands here. Rows
        are immutable — security rules deny update + delete on the audit_log
        collection.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-ink-muted)]">
                  No audit rows yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-[var(--color-cream-deep)]/30">
                <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                  {r.createdAt ? r.createdAt.toLocaleString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex rounded bg-[var(--color-navy)]/10 px-2 py-1 text-xs font-mono font-semibold text-[var(--color-navy)]">
                    {r.action}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  {r.actorEmail || "system"}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                  {r.targetType ? (
                    <>
                      {r.targetType}
                      {r.targetId && (
                        <span className="block text-[10px] text-[var(--color-ink-muted)]">
                          {r.targetId}
                        </span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-[10px] font-mono text-[var(--color-ink-muted)]">
                  {r.ip || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
