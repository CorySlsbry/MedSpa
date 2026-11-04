"use client";

import { useState } from "react";

export type AppointmentRow = {
  id: string;
  starts_at_iso: string;
  ends_at_iso: string;
  client_id: string;
  client_name: string;
  provider_id: string;
  provider_name: string;
  service: string;
  status: string;
  notes: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-amber-100 text-amber-800",
  checked_in: "bg-emerald-100 text-emerald-800",
  in_service: "bg-sky-100 text-sky-800",
  completed: "bg-[var(--color-cream-deep)] text-[var(--color-ink-muted)]",
  cancelled: "bg-rose-100 text-rose-800",
  no_show: "bg-rose-100 text-rose-800",
};

/**
 * Shared appointments table used by manager / front-desk / provider
 * portals. Server-side parents fetch + scope the rows; this component
 * just renders + wires up actions per role.
 *
 * The `actorRole` prop drives which actions appear:
 *   - tenant_front_desk: Check-in button when status = scheduled
 *   - tenant_provider:   read-only (charting flow lives on /provider/charts)
 *   - tenant_manager:    Cancel + Reschedule buttons (next iteration)
 *   - tenant_owner:      Same as manager — owner already has the deeper
 *                        appointments page, this is for cross-context use
 */
type ActorRole =
  | "tenant_owner"
  | "tenant_manager"
  | "tenant_provider"
  | "tenant_front_desk";

export default function TenantAppointmentsList({
  appointments,
  actorRole,
  emptyMessage,
}: {
  appointments: AppointmentRow[];
  actorRole: ActorRole;
  emptyMessage?: string;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({});

  async function checkIn(id: string) {
    setPendingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/appointments/${id}/check-in`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't check the client in.");
        return;
      }
      setLocalStatus((prev) => ({ ...prev, [id]: "checked_in" }));
    } catch {
      setError("Network error. Try again in a moment.");
    } finally {
      setPendingId(null);
    }
  }

  if (appointments.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-sm text-[var(--color-ink-muted)]">
        {emptyMessage ?? "No appointments to show."}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        <table className="w-full text-sm">
          <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            <tr className="border-b border-[var(--color-line)]">
              <th className="px-4 py-2.5">Time</th>
              <th className="px-4 py-2.5">Client</th>
              <th className="px-4 py-2.5">Service</th>
              <th className="px-4 py-2.5">Provider</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {appointments.map((a) => {
              const status = localStatus[a.id] ?? a.status;
              const startTs = new Date(a.starts_at_iso);
              const isToday =
                startTs.toDateString() === new Date().toDateString();
              return (
                <tr key={a.id}>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs font-semibold text-[var(--color-navy)]">
                      {startTs.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </div>
                    {!isToday && (
                      <div className="text-[10px] text-[var(--color-ink-muted)]">
                        {startTs.toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-[var(--color-navy)]">{a.client_name}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-ink-soft)]">{a.service || "Visit"}</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-ink-soft)]">{a.provider_name || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        STATUS_STYLES[status] ?? "bg-[var(--color-cream-deep)] text-[var(--color-ink-muted)]"
                      }`}
                    >
                      {status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {actorRole === "tenant_front_desk" && status === "scheduled" && (
                      <button
                        type="button"
                        disabled={pendingId === a.id}
                        onClick={() => void checkIn(a.id)}
                        className="rounded-md bg-[var(--color-navy)] px-3 py-1 text-[11px] font-semibold text-[var(--color-cream)] disabled:opacity-50"
                      >
                        {pendingId === a.id ? "Checking in…" : "Check in"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
