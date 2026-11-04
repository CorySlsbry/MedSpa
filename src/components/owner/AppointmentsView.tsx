"use client";

import { useMemo, useState } from "react";
import type {
  ApptRow,
  ProviderOption,
  ClientOption,
  ServiceOption,
  LocationOption2,
} from "@/app/owner/appointments/page";
import type { AppointmentStatus } from "@/lib/firestore-types";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  checked_in: "Checked in",
  in_progress: "In progress",
  completed: "Completed",
  no_show: "No show",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  scheduled: "bg-[var(--color-gold)]/15 text-[var(--color-gold-deep)]",
  checked_in: "bg-[var(--color-teal)]/15 text-[var(--color-teal-deep)]",
  in_progress: "bg-[var(--color-teal)]/30 text-[var(--color-teal-deep)]",
  completed: "bg-emerald-100 text-emerald-800",
  no_show: "bg-rose-100 text-rose-800",
  cancelled: "bg-gray-100 text-gray-700",
};

const ACTIVE_STATUSES: AppointmentStatus[] = ["scheduled", "checked_in", "in_progress"];

export default function AppointmentsView({
  initialRows,
  locations,
  providers,
  services,
  clients,
}: {
  initialRows: ApptRow[];
  locations: LocationOption2[];
  providers: ProviderOption[];
  services: ServiceOption[];
  clients: ClientOption[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<"upcoming" | "all">("upcoming");
  const [cancelTarget, setCancelTarget] = useState<ApptRow | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<ApptRow | null>(null);

  const visible = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.startsAt && r.startsAt.getTime() >= Date.now() - 60 * 60 * 1000);
  }, [rows, filter]);

  const canSchedule =
    locations.length > 0 &&
    providers.length > 0 &&
    services.length > 0 &&
    clients.length > 0;

  async function createAppointment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    const dateStr = String(fd.get("date") || "");
    const timeStr = String(fd.get("time") || "");
    if (!dateStr || !timeStr) {
      setErrorMsg("Pick a date and time.");
      setCreating(false);
      return;
    }
    const startsAt = new Date(`${dateStr}T${timeStr}`);
    if (Number.isNaN(startsAt.getTime())) {
      setErrorMsg("That date/time is invalid.");
      setCreating(false);
      return;
    }
    const payload = {
      client_id: String(fd.get("client_id") || ""),
      provider_id: String(fd.get("provider_id") || ""),
      location_id: String(fd.get("location_id") || ""),
      service_id: String(fd.get("service_id") || ""),
      starts_at: startsAt.toISOString(),
      notes: String(fd.get("notes") || "").trim() || undefined,
    };
    if (!payload.client_id || !payload.provider_id || !payload.location_id || !payload.service_id) {
      setErrorMsg("Pick a client, provider, location, and service.");
      setCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/owner/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Could not schedule.");
        setCreating(false);
        return;
      }
      // Soft refresh — easier than rebuilding the row from scratch
      window.location.reload();
    } catch {
      setErrorMsg("Network error.");
      setCreating(false);
    }
  }

  async function setStatus(id: string, status: AppointmentStatus) {
    try {
      const res = await fetch(`/api/owner/appointments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch {
      /* ignore */
    }
  }

  const primaryLocation = locations.find((l) => l.isPrimary) ?? locations[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(["upcoming", "all"] as const).map((f) => (
            <button
              key={f}
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
        {canSchedule && !showCreate && (
          <button onClick={() => setShowCreate(true)} className="btn btn-gold">
            + Schedule
          </button>
        )}
      </div>

      {showCreate && canSchedule && (
        <form
          onSubmit={createAppointment}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
              Schedule appointment
            </h2>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="text-xs text-[var(--color-ink-muted)] hover:underline"
            >
              Cancel
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Select label="Client" name="client_id" required>
              <option value="">— Select client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
            <Select label="Provider" name="provider_id" required>
              <option value="">— Select provider —</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <Select label="Location" name="location_id" required defaultValue={primaryLocation?.id}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.isPrimary ? " (primary)" : ""}
                </option>
              ))}
            </Select>
            <Select label="Service" name="service_id" required>
              <option value="">— Select service —</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.durationMinutes} min)
                </option>
              ))}
            </Select>
            <Field label="Date" name="date" type="date" required />
            <Field label="Time" name="time" type="time" required />
            <label className="block md:col-span-2">
              <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Notes
              </span>
              <textarea
                name="notes"
                rows={2}
                placeholder="Anything the provider should know..."
                className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
              />
            </label>
          </div>
          {errorMsg && (
            <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errorMsg}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="submit"
              disabled={creating}
              className="btn btn-gold disabled:cursor-wait disabled:opacity-70"
            >
              {creating ? "Scheduling..." : "Schedule"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
            No appointments {filter === "upcoming" ? "upcoming" : "to show"}.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {visible.map((r) => {
                const isActive = ACTIVE_STATUSES.includes(r.status);
                return (
                  <tr key={r.id} className="hover:bg-[var(--color-cream-deep)]/30">
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                      {r.startsAt?.toLocaleString() ?? "—"}
                      {r.locationName && (
                        <div className="text-[10px]">{r.locationName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">{r.service}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                      {r.providerName || r.providerId.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                      {r.clientName || r.clientId.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={r.status}
                        onChange={(e) => setStatus(r.id, e.target.value as AppointmentStatus)}
                        className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${STATUS_COLOR[r.status]}`}
                      >
                        {Object.entries(STATUS_LABEL).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isActive ? (
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => setRescheduleTarget(r)}
                            className="rounded border border-[var(--color-line)] px-2 py-1 text-[10px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
                          >
                            Reschedule
                          </button>
                          <button
                            onClick={() => setCancelTarget(r)}
                            className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-[var(--color-ink-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {cancelTarget && (
        <CancelModal
          row={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => {
            setRows((prev) =>
              prev.map((r) => (r.id === cancelTarget.id ? { ...r, status: "cancelled" } : r)),
            );
            setCancelTarget(null);
          }}
        />
      )}

      {rescheduleTarget && (
        <RescheduleModal
          row={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onRescheduled={(newStartsAt, newEndsAt) => {
            setRows((prev) =>
              prev.map((r) =>
                r.id === rescheduleTarget.id
                  ? { ...r, startsAt: newStartsAt, endsAt: newEndsAt }
                  : r,
              ),
            );
            setRescheduleTarget(null);
          }}
        />
      )}
    </div>
  );
}

function CancelModal({
  row,
  onClose,
  onCancelled,
}: {
  row: ApptRow;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/owner/appointments/${row.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim() || undefined,
          notify_client: notify,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not cancel.");
        setSubmitting(false);
        return;
      }
      onCancelled();
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Cancel appointment">
      <div className="space-y-3 text-sm text-[var(--color-ink)]">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 px-3 py-2 text-xs">
          <div className="font-semibold">{row.service}</div>
          <div className="text-[var(--color-ink-muted)]">
            {row.startsAt?.toLocaleString() ?? "—"} · {row.clientName || row.clientId.slice(0, 8)}
          </div>
        </div>
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Internal reason (optional — do not include patient health info)
          </span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Client requested, double-booked, etc."
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="h-4 w-4"
          />
          Notify client by email and SMS (if opted in)
        </label>
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
        >
          Keep appointment
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-wait disabled:opacity-70"
        >
          {submitting ? "Cancelling..." : "Cancel appointment"}
        </button>
      </div>
    </ModalShell>
  );
}

function RescheduleModal({
  row,
  onClose,
  onRescheduled,
}: {
  row: ApptRow;
  onClose: () => void;
  onRescheduled: (newStartsAt: Date, newEndsAt: Date) => void;
}) {
  const initialDate = row.startsAt
    ? `${row.startsAt.getFullYear()}-${String(row.startsAt.getMonth() + 1).padStart(2, "0")}-${String(row.startsAt.getDate()).padStart(2, "0")}`
    : "";
  const initialTime = row.startsAt
    ? `${String(row.startsAt.getHours()).padStart(2, "0")}:${String(row.startsAt.getMinutes()).padStart(2, "0")}`
    : "";
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const durationMs =
    row.startsAt && row.endsAt ? row.endsAt.getTime() - row.startsAt.getTime() : 30 * 60_000;

  async function submit() {
    setErr(null);
    if (!date || !time) {
      setErr("Pick a new date and time.");
      return;
    }
    const newStartsAt = new Date(`${date}T${time}`);
    if (Number.isNaN(newStartsAt.getTime())) {
      setErr("Invalid date/time.");
      return;
    }
    if (newStartsAt.getTime() < Date.now() + 5 * 60_000) {
      setErr("New time must be at least 5 minutes from now.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/owner/appointments/${row.id}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starts_at: newStartsAt.toISOString(),
          notify_client: notify,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not reschedule.");
        setSubmitting(false);
        return;
      }
      const newEndsAt = new Date(newStartsAt.getTime() + durationMs);
      onRescheduled(newStartsAt, newEndsAt);
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Reschedule appointment">
      <div className="space-y-3 text-sm text-[var(--color-ink)]">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 px-3 py-2 text-xs">
          <div className="font-semibold">{row.service}</div>
          <div className="text-[var(--color-ink-muted)]">
            Currently {row.startsAt?.toLocaleString() ?? "—"} · {row.clientName || row.clientId.slice(0, 8)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              New date
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              New time
            </span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="h-4 w-4"
          />
          Notify client by email and SMS (if opted in)
        </label>
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
        >
          Keep current time
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="btn btn-gold disabled:cursor-wait disabled:opacity-70"
        >
          {submitting ? "Rescheduling..." : "Reschedule"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-[var(--color-navy)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--color-ink-muted)] hover:underline"
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      />
    </label>
  );
}

function Select({
  label,
  name,
  required,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </span>
      <select
        name={name}
        required={required}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      >
        {children}
      </select>
    </label>
  );
}
