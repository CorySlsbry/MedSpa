"use client";

import { useMemo, useState } from "react";
import type { ProductRow } from "@/app/owner/inventory/page";

const UNITS = ["unit", "ml", "vial", "ea", "syringe"] as const;
type Unit = (typeof UNITS)[number];

export default function InventoryView({ initialRows }: { initialRows: ProductRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [movement, setMovement] = useState<{ row: ProductRow; type: MovementType } | null>(null);
  const [filter, setFilter] = useState<"active" | "low" | "all">("active");

  const visible = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "low") return rows.filter((r) => r.isActive && r.lowStock);
    return rows.filter((r) => r.isActive);
  }, [rows, filter]);

  function refreshRow(id: string, patch: Partial<ProductRow>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        next.lowStock =
          next.isActive &&
          next.reorderThreshold !== null &&
          next.onHand <= next.reorderThreshold;
        return next;
      }),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(["active", "low", "all"] as const).map((f) => (
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
              {f === "low" ? "Low stock" : f}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="btn btn-gold"
        >
          + Add product
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
            {filter === "low"
              ? "No low-stock items right now."
              : "No products yet. Click + Add product to start."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">On hand</th>
                <th className="px-4 py-3 text-right">Reorder at</th>
                <th className="px-4 py-3">Cost / unit</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {visible.map((r) => (
                <tr
                  key={r.id}
                  className={`hover:bg-[var(--color-cream-deep)]/30 ${r.lowStock ? "bg-rose-50/40" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-[var(--color-navy)]">{r.name}</div>
                    <div className="text-[10px] text-[var(--color-ink-muted)]">
                      {r.unit}
                      {r.sku ? ` · ${r.sku}` : ""}
                      {r.supplier ? ` · ${r.supplier}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`font-display text-lg font-bold ${
                        r.lowStock
                          ? "text-rose-700"
                          : r.onHand < 0
                          ? "text-amber-700"
                          : "text-[var(--color-navy)]"
                      }`}
                    >
                      {r.onHand}
                    </span>
                    <span className="ml-1 text-[10px] text-[var(--color-ink-muted)]">{r.unit}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-[var(--color-ink-soft)]">
                    {r.reorderThreshold ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                    {r.costCentsPerUnit !== null
                      ? `$${(r.costCentsPerUnit / 100).toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setMovement({ row: r, type: "received" })}
                        className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        Receive
                      </button>
                      <button
                        type="button"
                        onClick={() => setMovement({ row: r, type: "adjusted" })}
                        className="rounded border border-[var(--color-line)] px-2 py-1 text-[10px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
                      >
                        Adjust
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(r)}
                        className="rounded border border-[var(--color-line)] px-2 py-1 text-[10px] font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
                      >
                        Edit
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
        <AddProductModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            window.location.reload();
          }}
        />
      )}

      {editing && (
        <EditProductModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            refreshRow(editing.id, patch);
            setEditing(null);
          }}
          onArchived={() => {
            setRows((prev) => prev.filter((r) => r.id !== editing.id));
            setEditing(null);
          }}
        />
      )}

      {movement && (
        <MovementModal
          row={movement.row}
          type={movement.type}
          onClose={() => setMovement(null)}
          onApplied={(newBalance) => {
            refreshRow(movement.row.id, { onHand: newBalance });
            setMovement(null);
          }}
        />
      )}
    </div>
  );
}

type MovementType = "received" | "used" | "adjusted" | "expired" | "returned";

function AddProductModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    setSubmitting(true);
    setErr(null);
    const onHand = Number(fd.get("on_hand") || 0);
    const reorder = fd.get("reorder_threshold");
    const cost = fd.get("cost_cents_per_unit");
    const payload = {
      name: String(fd.get("name") || "").trim(),
      sku: String(fd.get("sku") || "").trim() || undefined,
      unit: String(fd.get("unit") || "unit") as Unit,
      on_hand_quantity: Number.isFinite(onHand) ? onHand : 0,
      reorder_threshold: reorder ? Number(reorder) : null,
      cost_cents_per_unit:
        cost && String(cost).trim() !== ""
          ? Math.round(Number(cost) * 100)
          : null,
      supplier: String(fd.get("supplier") || "").trim() || undefined,
      notes: String(fd.get("notes") || "").trim() || undefined,
    };
    if (!payload.name) {
      setErr("Name is required.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/owner/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not create.");
        setSubmitting(false);
        return;
      }
      onCreated();
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Add product">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name" name="name" required placeholder="Botox 100u vial" />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Unit" name="unit" defaultValue="unit">
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </SelectField>
          <Field label="SKU (optional)" name="sku" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="On hand" name="on_hand" type="number" defaultValue="0" />
          <Field label="Reorder at" name="reorder_threshold" type="number" placeholder="e.g. 2" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost / unit ($)" name="cost_cents_per_unit" type="number" placeholder="e.g. 425" />
          <Field label="Supplier" name="supplier" placeholder="Allergan" />
        </div>
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Notes
          </span>
          <textarea
            name="notes"
            rows={2}
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          />
        </label>
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn btn-gold disabled:opacity-70">
            {submitting ? "Adding..." : "Add product"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditProductModal({
  row,
  onClose,
  onSaved,
  onArchived,
}: {
  row: ProductRow;
  onClose: () => void;
  onSaved: (patch: Partial<ProductRow>) => void;
  onArchived: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    setSubmitting(true);
    setErr(null);
    const reorder = fd.get("reorder_threshold");
    const cost = fd.get("cost_cents_per_unit");
    const patch = {
      name: String(fd.get("name") || row.name).trim(),
      sku: String(fd.get("sku") || "").trim() || null,
      unit: String(fd.get("unit") || row.unit) as Unit,
      reorder_threshold: reorder && String(reorder).trim() !== "" ? Number(reorder) : null,
      cost_cents_per_unit:
        cost && String(cost).trim() !== "" ? Math.round(Number(cost) * 100) : null,
      supplier: String(fd.get("supplier") || "").trim() || null,
      notes: String(fd.get("notes") || "").trim() || null,
    };
    try {
      const res = await fetch(`/api/owner/products/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not save.");
        setSubmitting(false);
        return;
      }
      onSaved({
        name: patch.name,
        sku: patch.sku,
        unit: patch.unit,
        reorderThreshold: patch.reorder_threshold,
        costCentsPerUnit: patch.cost_cents_per_unit,
        supplier: patch.supplier,
        notes: patch.notes,
      });
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  async function archive() {
    if (!confirm(`Archive ${row.name}? Stock history is preserved; the product just stops appearing in pickers.`)) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/owner/products/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setErr(b?.error || "Could not archive.");
        setSubmitting(false);
        return;
      }
      onArchived();
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={`Edit ${row.name}`}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name" name="name" required defaultValue={row.name} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Unit" name="unit" defaultValue={row.unit}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </SelectField>
          <Field label="SKU" name="sku" defaultValue={row.sku ?? ""} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Reorder at"
            name="reorder_threshold"
            type="number"
            defaultValue={row.reorderThreshold !== null ? String(row.reorderThreshold) : ""}
          />
          <Field
            label="Cost / unit ($)"
            name="cost_cents_per_unit"
            type="number"
            defaultValue={row.costCentsPerUnit !== null ? (row.costCentsPerUnit / 100).toFixed(2) : ""}
          />
        </div>
        <Field label="Supplier" name="supplier" defaultValue={row.supplier ?? ""} />
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Notes
          </span>
          <textarea
            name="notes"
            rows={2}
            defaultValue={row.notes ?? ""}
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          />
        </label>
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
        <div className="flex justify-between pt-2">
          <button
            type="button"
            onClick={archive}
            disabled={submitting}
            className="text-xs font-semibold text-rose-700 hover:underline disabled:opacity-70"
          >
            Archive product
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn btn-gold disabled:opacity-70">
              {submitting ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

function MovementModal({
  row,
  type,
  onClose,
  onApplied,
}: {
  row: ProductRow;
  type: MovementType;
  onClose: () => void;
  onApplied: (newBalance: number) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const titleByType: Record<MovementType, string> = {
    received: `Receive ${row.name}`,
    used: `Mark ${row.name} used`,
    adjusted: `Adjust ${row.name}`,
    expired: `Write off ${row.name}`,
    returned: `Return ${row.name}`,
  };
  const helpByType: Record<MovementType, string> = {
    received: "Add stock from a supplier shipment.",
    used: "Manually log a use that wasn't tied to a chart.",
    adjusted: "Use ± numbers. -3 lowers count by 3, +5 raises by 5.",
    expired: "Write off expired or damaged stock.",
    returned: "Stock returned to inventory.",
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const qtyRaw = String(fd.get("qty") || "").trim();
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty === 0) {
      setErr("Enter a non-zero quantity.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/owner/products/${row.id}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          qty,
          reason: String(fd.get("reason") || "").trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not apply.");
        setSubmitting(false);
        return;
      }
      onApplied(body.balance_after);
    } catch {
      setErr("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={titleByType[type]}>
      <form onSubmit={submit} className="space-y-3">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 px-3 py-2 text-xs">
          On hand: <span className="font-bold text-[var(--color-navy)]">{row.onHand}</span> {row.unit}
        </div>
        <p className="text-xs text-[var(--color-ink-muted)]">{helpByType[type]}</p>
        <Field
          label={type === "adjusted" ? "Quantity (signed)" : "Quantity"}
          name="qty"
          type="number"
          step="any"
          required
          autoFocus
        />
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Reason / note
          </span>
          <input
            name="reason"
            type="text"
            placeholder={type === "received" ? "PO #1234" : "Brief note"}
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          />
        </label>
        {err && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-soft)]">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn btn-gold disabled:opacity-70">
            {submitting ? "Applying..." : "Apply"}
          </button>
        </div>
      </form>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-[var(--color-navy)]">{title}</h3>
          <button type="button" onClick={onClose} className="text-xs text-[var(--color-ink-muted)] hover:underline">
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
  step,
  autoFocus,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  step?: string;
  autoFocus?: boolean;
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
        step={step}
        autoFocus={autoFocus}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
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
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      >
        {children}
      </select>
    </label>
  );
}
