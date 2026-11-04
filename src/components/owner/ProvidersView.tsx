"use client";

import { useState } from "react";
import type { ProviderRow, LocationOption } from "@/app/owner/providers/page";

export default function ProvidersView({
  initialRows,
  locations,
}: {
  initialRows: ProviderRow[];
  locations: LocationOption[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [showInvite, setShowInvite] = useState(initialRows.length === 0);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function inviteProvider(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const payload = {
      email: String(fd.get("email") || "").trim().toLowerCase(),
      full_name: String(fd.get("full_name") || "").trim(),
      title: String(fd.get("title") || "").trim() || undefined,
      phone: String(fd.get("phone") || "").trim() || undefined,
      default_location_id: String(fd.get("default_location_id") || "") || undefined,
      send_invite: true,
    };
    if (!payload.email || !payload.full_name) {
      setErrorMsg("Email and name are required.");
      setCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/owner/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Could not invite provider.");
        setCreating(false);
        return;
      }
      const newRow: ProviderRow = {
        id: body.providerUid,
        email: payload.email,
        fullName: payload.full_name,
        title: payload.title ?? null,
        phone: payload.phone ?? null,
        schedulingColor: null,
        defaultLocationId: payload.default_location_id ?? null,
        isActive: true,
        createdAt: new Date(),
      };
      setRows((prev) => [newRow, ...prev]);
      setSuccessMsg(`Invite sent to ${payload.email}.`);
      formEl.reset();
      setTimeout(() => setShowInvite(false), 1500);
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setCreating(false);
    }
  }

  async function deactivate(id: string) {
    if (!confirm("Deactivate this provider? Their access will be revoked.")) return;
    try {
      const res = await fetch(`/api/owner/providers/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, isActive: false } : r)),
      );
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      {!showInvite && (
        <button onClick={() => setShowInvite(true)} className="btn btn-gold">
          + Invite a provider
        </button>
      )}

      {showInvite && (
        <form
          onSubmit={inviteProvider}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
              Invite a provider
            </h2>
            <button
              type="button"
              onClick={() => setShowInvite(false)}
              className="text-xs text-[var(--color-ink-muted)] hover:underline"
            >
              Cancel
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Field label="Email" name="email" type="email" required placeholder="person1@example.com" />
            <Field label="Full name" name="full_name" required placeholder="Sarah Roberts" />
            <Field label="Title" name="title" placeholder="RN, NP, Aesthetician..." />
            <Field label="Phone" name="phone" type="tel" />
            {locations.length > 0 && (
              <label className="block md:col-span-2">
                <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Default location
                </span>
                <select
                  name="default_location_id"
                  className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
                >
                  <option value="">— Select —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {errorMsg && (
            <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="mt-4 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              {successMsg}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="submit"
              disabled={creating}
              className="btn btn-gold disabled:cursor-wait disabled:opacity-70"
            >
              {creating ? "Sending invite..." : "Send invite"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
            No providers yet. Invite your first above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--color-cream-deep)]/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {r.schedulingColor && (
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: r.schedulingColor }}
                        />
                      )}
                      <div>
                        <div className="font-semibold text-[var(--color-navy)]">{r.fullName}</div>
                        <div className="text-xs text-[var(--color-ink-muted)]">{r.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">{r.title || "—"}</td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                    {r.phone || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.isActive ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
                        active
                      </span>
                    ) : (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-800">
                        inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <a
                        href={`/owner/providers/${r.id}`}
                        className="rounded border border-[var(--color-line)] px-2.5 py-1 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
                      >
                        Schedule
                      </a>
                      {r.isActive && (
                        <button
                          onClick={() => deactivate(r.id)}
                          className="rounded border border-[var(--color-line)] px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
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
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      />
    </label>
  );
}
