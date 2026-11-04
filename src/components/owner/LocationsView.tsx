"use client";

import { useState } from "react";
import type { LocationRow } from "@/app/owner/locations/page";

export default function LocationsView({ initialRows }: { initialRows: LocationRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [showCreate, setShowCreate] = useState(initialRows.length === 0);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function createLocation(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setErrorMsg(null);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const payload = {
      name: String(fd.get("name") || "").trim(),
      address_line_1: String(fd.get("address_line_1") || "").trim(),
      city: String(fd.get("city") || "").trim(),
      state: String(fd.get("state") || "").trim(),
      postal_code: String(fd.get("postal_code") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      timezone: String(fd.get("timezone") || "America/Denver"),
      is_primary: fd.get("is_primary") === "on",
    };
    if (!payload.name) {
      setErrorMsg("Name is required.");
      setCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/owner/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Could not create location.");
        setCreating(false);
        return;
      }
      // Optimistic update
      const newRow: LocationRow = {
        id: body.id,
        name: payload.name,
        addressLine1: payload.address_line_1 || null,
        addressLine2: null,
        city: payload.city || null,
        state: payload.state || null,
        postalCode: payload.postal_code || null,
        country: "US",
        phone: payload.phone || null,
        timezone: payload.timezone,
        isPrimary: payload.is_primary,
        isActive: true,
        createdAt: new Date(),
      };
      setRows((prev) => {
        const next = payload.is_primary
          ? prev.map((r) => ({ ...r, isPrimary: false }))
          : prev;
        return [newRow, ...next];
      });
      formEl.reset();
      setShowCreate(false);
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setCreating(false);
    }
  }

  async function setPrimary(id: string) {
    try {
      const res = await fetch(`/api/owner/locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_primary: true }),
      });
      if (!res.ok) return;
      setRows((prev) => prev.map((r) => ({ ...r, isPrimary: r.id === id })));
    } catch {
      /* ignore */
    }
  }

  async function deactivate(id: string) {
    if (!confirm("Deactivate this location? You can reactivate later.")) return;
    try {
      const res = await fetch(`/api/owner/locations/${id}`, { method: "DELETE" });
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
      {!showCreate && (
        <button
          onClick={() => setShowCreate(true)}
          className="btn btn-gold"
        >
          + Add a location
        </button>
      )}

      {showCreate && (
        <form
          onSubmit={createLocation}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
              New location
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
            <Field label="Name" name="name" required placeholder="Park City Aesthetics" />
            <Field label="Phone" name="phone" type="tel" placeholder="(801) 555-0100" />
            <Field label="Address line 1" name="address_line_1" className="md:col-span-2" />
            <Field label="City" name="city" />
            <Field label="State" name="state" />
            <Field label="Postal code" name="postal_code" />
            <Field label="Timezone" name="timezone" defaultValue="America/Denver" />
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-[var(--color-ink)]">
            <input type="checkbox" name="is_primary" defaultChecked={rows.length === 0} />
            Make this the primary location
          </label>
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
              {creating ? "Creating..." : "Create location"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
            No locations yet. Add your first one above.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-[var(--color-navy)]">{r.name}</h3>
                    {r.isPrimary && (
                      <span className="rounded-full bg-[var(--color-gold)]/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
                        Primary
                      </span>
                    )}
                    {!r.isActive && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-800">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    {[r.addressLine1, r.city, r.state, r.postalCode].filter(Boolean).join(", ") || "No address yet"}
                    {r.phone && ` · ${r.phone}`}
                    {` · ${r.timezone}`}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {r.isActive && !r.isPrimary && (
                    <button
                      onClick={() => setPrimary(r.id)}
                      className="rounded border border-[var(--color-line)] px-2.5 py-1 font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
                    >
                      Set primary
                    </button>
                  )}
                  {r.isActive && (
                    <button
                      onClick={() => deactivate(r.id)}
                      className="rounded border border-[var(--color-line)] px-2.5 py-1 font-semibold text-rose-700 hover:bg-rose-50"
                    >
                      Deactivate
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
  defaultValue,
  className,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
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
