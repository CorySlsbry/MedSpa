"use client";

import { useMemo, useState } from "react";
import type {
  ClientOption,
  WaitlistRow,
} from "@/app/owner/waitlist/page";
import type { WaitlistDoc } from "@/lib/firestore-types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_PILL: Record<WaitlistDoc["status"], string> = {
  active: "bg-amber-100 text-amber-900",
  notified: "bg-blue-100 text-blue-800",
  booked: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-gray-100 text-gray-700",
};

export default function WaitlistView({
  initialRows,
  clients,
  services,
}: {
  initialRows: WaitlistRow[];
  clients: ClientOption[];
  services: string[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [showAdd, setShowAdd] = useState(false);

  const visible = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.status === "active" || r.status === "notified");
  }, [rows, filter]);

  async function changeStatus(id: string, status: WaitlistDoc["status"]) {
    await fetch(`/api/owner/waitlist/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, status, notifiedAt: status === "notified" ? new Date() : r.notifiedAt }
          : r,
      ),
    );
  }

  async function remove(id: string) {
    if (!confirm("Remove from waitlist?")) return;
    await fetch(`/api/owner/waitlist/${id}`, { method: "DELETE" });
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          {(["active", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${
                filter === f
                  ? "border-[var(--color-navy)] bg-[var(--color-navy)] text-[var(--color-cream)]"
                  : "border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="btn btn-gold"
        >
          + Add to waitlist
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
            {filter === "active"
              ? "No one waiting. Add a client when their preferred slot is full."
              : "No waitlist entries yet."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Preferred days</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {visible.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--color-cream-deep)]/30">
                  <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">
                    {r.clientName ?? r.clientId.slice(0, 8)}
                    {r.createdAt && (
                      <div className="text-[10px] font-normal text-[var(--color-ink-muted)]">
                        Added {r.createdAt.toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                    {r.serviceName}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.preferredDays.length === 0 ? (
                      <span className="text-[var(--color-ink-muted)]">Any</span>
                    ) : (
                      <div className="flex gap-1">
                        {r.preferredDays.map((d) => (
                          <span
                            key={d}
                            className="rounded border border-[var(--color-line)] bg-[var(--color-cream)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-ink)]"
                          >
                            {DAY_NAMES[d]}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                    {r.notes ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_PILL[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      {r.status === "active" && (
                        <button
                          type="button"
                          onClick={() => changeStatus(r.id, "notified")}
                          className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          Mark notified
                        </button>
                      )}
                      {(r.status === "active" || r.status === "notified") && (
                        <button
                          type="button"
                          onClick={() => changeStatus(r.id, "booked")}
                          className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          Booked
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(r.id)}
                        className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddModal
          clients={clients}
          services={services}
          onClose={() => setShowAdd(false)}
          onAdded={(row) => {
            setRows((prev) => [row, ...prev]);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function AddModal({
  clients,
  services,
  onClose,
  onAdded,
}: {
  clients: ClientOption[];
  services: string[];
  onClose: () => void;
  onAdded: (row: WaitlistRow) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState<Set<number>>(new Set());

  function toggle(d: number) {
    setDays((prev) => {
      const n = new Set(prev);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const clientId = String(fd.get("client_id") || "");
    const service = String(fd.get("service_name") || "").trim();
    const notes = String(fd.get("notes") || "").trim() || undefined;
    if (!clientId || !service) {
      setErr("Pick a client and a service.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/owner/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          service_name: service,
          notes,
          preferred_days: Array.from(days).sort(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not add.");
        setSubmitting(false);
        return;
      }
      const clientName =
        clients.find((c) => c.id === clientId)?.label.split(" · ")[0] ?? null;
      onAdded({
        id: body.id,
        clientId,
        clientName,
        serviceName: service,
        notes: notes ?? null,
        preferredDays: Array.from(days).sort(),
        status: "active",
        notifiedAt: null,
        createdAt: new Date(),
      });
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-[var(--color-navy)]">
            Add to waitlist
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--color-ink-muted)] hover:underline"
          >
            Close
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Client
            </span>
            <select
              name="client_id"
              required
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm"
            >
              <option value="">— Select client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Service
            </span>
            <input
              name="service_name"
              list="service-options"
              required
              placeholder="HydraFacial"
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm"
            />
            <datalist id="service-options">
              {services.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Preferred days (optional)
            </span>
            <div className="mt-1 flex flex-wrap gap-1">
              {DAY_NAMES.map((name, idx) => {
                const on = days.has(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggle(idx)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                      on
                        ? "border-[var(--color-navy)] bg-[var(--color-navy)] text-[var(--color-cream)]"
                        : "border-[var(--color-line)] text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Notes (optional)
            </span>
            <textarea
              name="notes"
              rows={2}
              placeholder="Mornings only, prefers Dr. Jane…"
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm"
            />
          </label>
          {err && (
            <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
              {err}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]"
            >
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn btn-gold disabled:opacity-70">
              {submitting ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
