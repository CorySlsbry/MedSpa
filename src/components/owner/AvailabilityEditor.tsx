"use client";

import { useEffect, useState } from "react";
import type { AvailabilityInterval } from "@/lib/firestore-types";

const DAYS = [
  { idx: 1, label: "Mon" },
  { idx: 2, label: "Tue" },
  { idx: 3, label: "Wed" },
  { idx: 4, label: "Thu" },
  { idx: 5, label: "Fri" },
  { idx: 6, label: "Sat" },
  { idx: 0, label: "Sun" },
];

type TimeOffRange = {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
};

export default function AvailabilityEditor({
  providerId,
  providerName,
}: {
  providerId: string;
  providerName: string;
}) {
  const [intervals, setIntervals] = useState<AvailabilityInterval[]>([]);
  const [isDefault, setIsDefault] = useState(true);
  const [timeOff, setTimeOff] = useState<TimeOffRange[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAddOff, setShowAddOff] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [aRes, tRes] = await Promise.all([
        fetch(`/api/owner/providers/${providerId}/availability`),
        fetch(`/api/owner/providers/${providerId}/time-off`),
      ]);
      const a = await aRes.json();
      const t = await tRes.json();
      if (!alive) return;
      if (aRes.ok) {
        setIntervals(a.intervals || []);
        setIsDefault(!!a.is_default);
      }
      if (tRes.ok) setTimeOff(t.ranges || []);
    })();
    return () => {
      alive = false;
    };
  }, [providerId]);

  function intervalsForDay(day: number) {
    return intervals
      .filter((i) => i.day === day)
      .sort((a, b) => a.start - b.start);
  }

  function setDayIntervals(day: number, list: AvailabilityInterval[]) {
    setIntervals((prev) => [...prev.filter((i) => i.day !== day), ...list]);
  }

  function addInterval(day: number) {
    const list = intervalsForDay(day);
    const last = list[list.length - 1];
    const start = last ? Math.min(last.end + 60, 1320) : 9 * 60;
    const end = Math.min(start + 240, 1440);
    setDayIntervals(day, [...list, { day, start, end }]);
  }

  function removeInterval(day: number, idx: number) {
    const list = intervalsForDay(day);
    list.splice(idx, 1);
    setDayIntervals(day, list);
  }

  function updateInterval(day: number, idx: number, patch: Partial<AvailabilityInterval>) {
    const list = intervalsForDay(day);
    list[idx] = { ...list[idx], ...patch };
    setDayIntervals(day, list);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/owner/providers/${providerId}/availability`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervals, template: null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not save.");
        setSaving(false);
        return;
      }
      setIsDefault(false);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1800);
    } catch {
      setErr("Network error.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTimeOff(rangeId: string) {
    if (!confirm("Delete this time-off range?")) return;
    await fetch(`/api/owner/providers/${providerId}/time-off/${rangeId}`, {
      method: "DELETE",
    });
    setTimeOff((prev) => prev.filter((r) => r.id !== rangeId));
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Weekly schedule
            </div>
            <h2 className="mt-1 font-display text-lg font-bold text-[var(--color-navy)]">
              When does {providerName} take appointments?
            </h2>
            {isDefault && (
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                Currently using the default 9-5 Mon–Fri. Save to customize.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn btn-gold disabled:opacity-70"
          >
            {saving ? "Saving…" : savedToast ? "Saved ✓" : "Save"}
          </button>
        </div>

        <div className="mt-5 divide-y divide-[var(--color-line)]">
          {DAYS.map((d) => (
            <div key={d.idx} className="flex items-start gap-4 py-3">
              <div className="w-12 shrink-0 text-sm font-bold uppercase tracking-wider text-[var(--color-ink-soft)]">
                {d.label}
              </div>
              <div className="flex-1 space-y-2">
                {intervalsForDay(d.idx).length === 0 ? (
                  <div className="text-xs text-[var(--color-ink-muted)]">Closed</div>
                ) : (
                  intervalsForDay(d.idx).map((iv, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="time"
                        value={minToTime(iv.start)}
                        onChange={(e) =>
                          updateInterval(d.idx, idx, { start: timeToMin(e.target.value) })
                        }
                        className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1 text-xs"
                      />
                      <span className="text-xs text-[var(--color-ink-muted)]">to</span>
                      <input
                        type="time"
                        value={minToTime(iv.end)}
                        onChange={(e) =>
                          updateInterval(d.idx, idx, { end: timeToMin(e.target.value) })
                        }
                        className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => removeInterval(d.idx, idx)}
                        className="text-[10px] text-rose-700 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={() => addInterval(d.idx)}
                className="rounded-lg border border-dashed border-[var(--color-line)] px-2 py-1 text-[10px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
              >
                + Add
              </button>
            </div>
          ))}
        </div>

        {err && (
          <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Time off
            </div>
            <h2 className="mt-1 font-display text-lg font-bold text-[var(--color-navy)]">
              Vacation, sick days, training
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setShowAddOff(true)}
            className="rounded-lg border border-[var(--color-navy)] bg-transparent px-3 py-1.5 text-xs font-semibold text-[var(--color-navy)] hover:bg-[var(--color-cream-deep)]"
          >
            + Add time off
          </button>
        </div>
        {timeOff.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-cream)] px-4 py-6 text-center text-xs text-[var(--color-ink-muted)]">
            No time-off scheduled.
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--color-line)]">
            {timeOff.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-semibold text-[var(--color-ink)]">
                    {new Date(r.starts_at).toLocaleDateString()} →{" "}
                    {new Date(r.ends_at).toLocaleDateString()}
                  </div>
                  {r.reason && (
                    <div className="text-[10px] text-[var(--color-ink-muted)]">{r.reason}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => deleteTimeOff(r.id)}
                  className="text-[10px] font-semibold text-rose-700 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showAddOff && (
        <AddTimeOffModal
          providerId={providerId}
          onClose={() => setShowAddOff(false)}
          onAdded={(range) => {
            setTimeOff((prev) =>
              [...prev, range].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
            );
            setShowAddOff(false);
          }}
        />
      )}
    </div>
  );
}

function AddTimeOffModal({
  providerId,
  onClose,
  onAdded,
}: {
  providerId: string;
  onClose: () => void;
  onAdded: (r: TimeOffRange) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const start = String(fd.get("start") || "");
    const end = String(fd.get("end") || "");
    const reason = String(fd.get("reason") || "").trim() || undefined;
    setSubmitting(true);
    setErr(null);
    if (!start || !end) {
      setErr("Pick both dates.");
      setSubmitting(false);
      return;
    }
    const startsAt = new Date(`${start}T00:00:00`).toISOString();
    const endsAt = new Date(`${end}T23:59:59`).toISOString();
    try {
      const res = await fetch(`/api/owner/providers/${providerId}/time-off`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starts_at: startsAt, ends_at: endsAt, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not add.");
        setSubmitting(false);
        return;
      }
      onAdded({ id: body.id, starts_at: startsAt, ends_at: endsAt, reason: reason ?? null });
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
            Add time off
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
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Start
              </span>
              <input
                type="date"
                name="start"
                required
                className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                End
              </span>
              <input
                type="date"
                name="end"
                required
                className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm"
              />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Reason (optional)
            </span>
            <input
              type="text"
              name="reason"
              placeholder="Vacation, conference, training…"
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
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-gold disabled:opacity-70"
            >
              {submitting ? "Adding…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function minToTime(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, "0");
  const m = (min % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMin(s: string): number {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return h * 60 + m;
}
