"use client";

import { useState } from "react";
import type { ServiceRow, ProductOption } from "@/app/owner/services/page";
import type { ServiceCategory, ServiceConsumes } from "@/lib/firestore-types";

const CATEGORIES: { value: ServiceCategory; label: string }[] = [
  { value: "injectables", label: "Injectables" },
  { value: "facial", label: "Facial" },
  { value: "laser", label: "Laser" },
  { value: "body", label: "Body" },
  { value: "iv_therapy", label: "IV Therapy" },
  { value: "wellness", label: "Wellness" },
  { value: "consultation", label: "Consultation" },
  { value: "other", label: "Other" },
];

export default function ServicesView({
  initialRows,
  products = [],
  inventoryEnabled = false,
}: {
  initialRows: ServiceRow[];
  products?: ProductOption[];
  inventoryEnabled?: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [showCreate, setShowCreate] = useState(initialRows.length === 0);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [consumesTarget, setConsumesTarget] = useState<ServiceRow | null>(null);

  async function createService(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    setErrorMsg(null);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const priceStr = String(fd.get("price") || "").trim();
    const priceCents = priceStr ? Math.round(parseFloat(priceStr) * 100) : undefined;
    const depositStr = String(fd.get("deposit") || "").trim();
    const depositCents = depositStr ? Math.round(parseFloat(depositStr) * 100) : null;
    const rebookStr = String(fd.get("recommended_rebook_days") || "").trim();
    const rebookDays = rebookStr ? parseInt(rebookStr, 10) : null;
    const payload = {
      name: String(fd.get("name") || "").trim(),
      category: String(fd.get("category") || "other") as ServiceCategory,
      duration_minutes: parseInt(String(fd.get("duration_minutes") || "30"), 10),
      price_cents: priceCents !== undefined && !Number.isNaN(priceCents) ? priceCents : undefined,
      description: String(fd.get("description") || "").trim() || undefined,
      deposit_cents: depositCents !== null && !Number.isNaN(depositCents) ? depositCents : null,
      recommended_rebook_days: rebookDays !== null && !Number.isNaN(rebookDays) ? rebookDays : null,
    };
    if (!payload.name) {
      setErrorMsg("Name is required.");
      setCreating(false);
      return;
    }
    if (!payload.duration_minutes || payload.duration_minutes < 5) {
      setErrorMsg("Duration must be at least 5 minutes.");
      setCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/owner/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Could not create service.");
        setCreating(false);
        return;
      }
      const newRow: ServiceRow = {
        id: body.id,
        name: payload.name,
        category: payload.category,
        durationMinutes: payload.duration_minutes,
        priceCents: payload.price_cents ?? null,
        description: payload.description ?? null,
        isActive: true,
        consumes: [],
        depositCents: payload.deposit_cents,
        recommendedRebookDays: payload.recommended_rebook_days,
        createdAt: new Date(),
      };
      setRows((prev) => [newRow, ...prev]);
      formEl.reset();
      setShowCreate(false);
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setCreating(false);
    }
  }

  async function deactivate(id: string) {
    if (!confirm("Deactivate this service? Existing appointments are unaffected.")) return;
    try {
      const res = await fetch(`/api/owner/services/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, isActive: false } : r)));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      {!showCreate && (
        <button onClick={() => setShowCreate(true)} className="btn btn-gold">
          + Add a service
        </button>
      )}

      {showCreate && (
        <form
          onSubmit={createService}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
              New service
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
            <Field label="Name" name="name" required placeholder="Botox 30u" />
            <label className="block">
              <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Category
              </span>
              <select
                name="category"
                defaultValue="injectables"
                className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <Field label="Duration (minutes)" name="duration_minutes" type="number" defaultValue="30" required />
            <Field label="Price (USD, optional)" name="price" type="number" placeholder="450" />
            <Field
              label="Booking deposit (USD, optional)"
              name="deposit"
              type="number"
              placeholder="50"
            />
            <Field
              label="Suggested rebook (days, optional)"
              name="recommended_rebook_days"
              type="number"
              placeholder="90"
            />
            <label className="block md:col-span-2">
              <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Description
              </span>
              <textarea
                name="description"
                rows={2}
                placeholder="What's included, any pre/post care..."
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
              {creating ? "Creating..." : "Create service"}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
            No services yet. Add your first above.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--color-cream-deep)]/30">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[var(--color-navy)]">{r.name}</div>
                    {r.description && (
                      <div className="text-xs text-[var(--color-ink-muted)] line-clamp-1">
                        {r.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)] capitalize">
                    {r.category.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                    {r.durationMinutes} min
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                    {r.priceCents != null ? `$${(r.priceCents / 100).toFixed(0)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.isActive ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">active</span>
                    ) : (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-800">inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      {inventoryEnabled && (
                        <button
                          onClick={() => setConsumesTarget(r)}
                          className="rounded border border-[var(--color-line)] px-2.5 py-1 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
                          title={
                            r.consumes.length === 0
                              ? "Link products consumed per visit"
                              : `${r.consumes.length} product(s) linked`
                          }
                        >
                          Consumes
                          {r.consumes.length > 0 && (
                            <span className="ml-1 rounded-full bg-[var(--color-teal)]/20 px-1.5 text-[10px] font-bold text-[var(--color-teal-deep)]">
                              {r.consumes.length}
                            </span>
                          )}
                        </button>
                      )}
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

      {consumesTarget && (
        <ConsumesModal
          row={consumesTarget}
          products={products}
          onClose={() => setConsumesTarget(null)}
          onSaved={(newConsumes) => {
            setRows((prev) =>
              prev.map((r) =>
                r.id === consumesTarget.id ? { ...r, consumes: newConsumes } : r,
              ),
            );
            setConsumesTarget(null);
          }}
        />
      )}
    </div>
  );
}

function ConsumesModal({
  row,
  products,
  onClose,
  onSaved,
}: {
  row: ServiceRow;
  products: ProductOption[];
  onClose: () => void;
  onSaved: (consumes: ServiceConsumes[]) => void;
}) {
  const [items, setItems] = useState<ServiceConsumes[]>(
    row.consumes.length > 0 ? row.consumes : [],
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addRow() {
    if (products.length === 0) return;
    setItems((prev) => [...prev, { product_id: products[0].id, qty: 1 }]);
  }

  function updateRow(idx: number, patch: Partial<ServiceConsumes>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeRow(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    setSubmitting(true);
    setErr(null);
    // Drop empty/zero rows
    const cleaned = items.filter(
      (it) => it.product_id && Number.isFinite(it.qty) && it.qty > 0,
    );
    try {
      const res = await fetch(`/api/owner/services/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consumes: cleaned.length > 0 ? cleaned : null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not save.");
        setSubmitting(false);
        return;
      }
      onSaved(cleaned);
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-[var(--color-navy)]">
            Products consumed per {row.name}
          </h3>
          <button type="button" onClick={onClose} className="text-xs text-[var(--color-ink-muted)] hover:underline">
            Close
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          When a chart for this service is signed, these products will be auto-deducted from inventory.
        </p>

        {products.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-cream)] px-4 py-6 text-center text-xs text-[var(--color-ink-muted)]">
            You have no active products. Add some in <a href="/owner/inventory" className="font-semibold text-[var(--color-teal-deep)] underline">Inventory</a> first.
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {items.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-cream)] px-4 py-6 text-center text-xs text-[var(--color-ink-muted)]">
                No products linked. Click + Add product below.
              </div>
            )}
            {items.map((it, idx) => {
              const product = products.find((p) => p.id === it.product_id);
              return (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={it.product_id}
                    onChange={(e) => updateRow(idx, { product_id: e.target.value })}
                    className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.unit})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    value={it.qty}
                    onChange={(e) => updateRow(idx, { qty: Number(e.target.value) })}
                    className="w-24 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
                  />
                  <span className="w-12 text-xs text-[var(--color-ink-muted)]">{product?.unit}</span>
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={addRow}
              className="rounded-lg border border-dashed border-[var(--color-line)] px-3 py-2 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
            >
              + Add product
            </button>
          </div>
        )}

        {err && (
          <div className="mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={submitting || products.length === 0}
            className="btn btn-gold disabled:opacity-70"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
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
