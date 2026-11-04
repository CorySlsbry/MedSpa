"use client";

import Link from "next/link";
import { useState } from "react";
import type { WorkflowRow } from "@/app/admin/(dashboard)/workflows/page";

const STATUS_PILL: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-emerald-100 text-emerald-800",
  paused: "bg-amber-100 text-amber-800",
  archived: "bg-rose-100 text-rose-800",
};

export default function WorkflowsView({ initialRows }: { initialRows: WorkflowRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setStatus(id: string, status: "active" | "paused") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
      }
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-[var(--color-line)] bg-[var(--color-paper)]/40 px-6 py-12 text-center">
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
          No workflows yet
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Create the first one to start enrolling leads. The brand tag applied
          at enrollment drives the external email-runner until the Aesthera
          mailer is wired.
        </p>
        <Link href="/admin/workflows/new" className="mt-4 inline-block btn btn-gold">
          + New workflow
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Trigger tag</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-center">Steps</th>
            <th className="px-4 py-3 text-center">Active</th>
            <th className="px-4 py-3 text-center">Total</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3 align-top">
                <Link
                  href={`/admin/workflows/${r.id}`}
                  className="font-semibold text-[var(--color-navy)] hover:underline"
                >
                  {r.name}
                </Link>
                {r.description && (
                  <div className="mt-0.5 text-[11px] text-[var(--color-ink-muted)] line-clamp-1">
                    {r.description}
                  </div>
                )}
              </td>
              <td className="px-4 py-3 align-top">
                {r.triggerTag ? (
                  <code className="rounded bg-[var(--color-cream)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-navy)]">
                    {r.triggerTag}
                  </code>
                ) : (
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    {r.triggerType.replace(/_/g, " ")}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 align-top">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                    STATUS_PILL[r.status] || STATUS_PILL.draft
                  }`}
                >
                  {r.status}
                </span>
              </td>
              <td className="px-4 py-3 align-top text-center text-xs text-[var(--color-ink-muted)]">
                {r.stepCount}
              </td>
              <td className="px-4 py-3 align-top text-center text-xs">
                <span
                  className={r.active > 0 ? "font-bold text-emerald-700" : "text-[var(--color-ink-muted)]"}
                >
                  {r.active}
                </span>
              </td>
              <td className="px-4 py-3 align-top text-center text-xs text-[var(--color-ink-muted)]">
                {r.total}
              </td>
              <td className="px-4 py-3 align-top text-right">
                {r.status === "active" ? (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => setStatus(r.id, "paused")}
                    className="text-xs font-semibold text-amber-700 hover:underline"
                  >
                    Pause
                  </button>
                ) : r.status === "paused" || r.status === "draft" ? (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => setStatus(r.id, "active")}
                    className="text-xs font-semibold text-emerald-700 hover:underline"
                  >
                    Activate
                  </button>
                ) : null}
                <Link
                  href={`/admin/workflows/${r.id}`}
                  className="ml-3 text-xs font-semibold text-[var(--color-teal)] hover:underline"
                >
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
