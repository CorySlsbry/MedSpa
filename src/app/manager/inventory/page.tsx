import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { TIER_LIMITS } from "@/lib/tier-limits";
import type { ProductDoc } from "@/lib/firestore-types";

export const metadata: Metadata = { title: "Manager · Inventory", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Manager inventory — read-only listing of products + low-stock flags.
 * Manager can see usage and reorder thresholds but can't add/edit
 * products (owner controls the catalog). Editing flow lives at
 * /owner/inventory.
 */
export default async function ManagerInventoryPage() {
  const ctx = await requireTenantContext("tenant_manager");
  const inventoryEnabled = TIER_LIMITS[ctx.tenant.subscription_tier].features.inventory;

  const snap = inventoryEnabled
    ? await tenantCol(ctx.tenant.id, "products")
        .orderBy("name", "asc")
        .limit(500)
        .get()
        .catch(() => null)
    : null;

  const rows = (snap?.docs ?? []).map((d) => {
    const p = d.data() as ProductDoc;
    return {
      id: d.id,
      name: p.name,
      sku: p.sku ?? "—",
      unit: p.unit,
      onHand: p.on_hand_quantity,
      reorderThreshold: p.reorder_threshold,
      isActive: p.is_active,
      lowStock:
        p.is_active &&
        p.reorder_threshold !== null &&
        p.reorder_threshold !== undefined &&
        p.on_hand_quantity <= p.reorder_threshold,
    };
  });

  const lowCount = rows.filter((r) => r.lowStock).length;
  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Manager · Inventory
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            Inventory
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            Stock levels and low-stock flags. To add or edit a product, ask the owner —
            they can do it from <Link href="/owner/inventory" className="font-semibold text-[var(--color-teal)] hover:underline">/owner/inventory</Link>.
          </p>
        </div>
        {inventoryEnabled && (
          <span className="text-sm text-[var(--color-ink-muted)]">
            {activeCount} active SKUs
            {lowCount > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-rose-700">{lowCount} low</span>
              </>
            )}
          </span>
        )}
      </div>

      {!inventoryEnabled && (
        <div className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-cream)] px-6 py-12 text-center">
          <h2 className="font-display text-xl font-bold text-[var(--color-navy)]">
            Inventory tracking isn&apos;t on this plan
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-soft)]">
            Ask your owner to upgrade — inventory is included on Basic, Growth,
            and Enterprise plans.
          </p>
        </div>
      )}

      {inventoryEnabled && (
        <div className="mt-6 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
          {rows.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-[var(--color-ink-muted)]">
              No products yet. Owner can add SKUs from /owner/inventory.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                <tr className="border-b border-[var(--color-line)]">
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5">SKU</th>
                  <th className="px-4 py-2.5 text-right">On hand</th>
                  <th className="px-4 py-2.5 text-right">Reorder at</th>
                  <th className="px-4 py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {rows.map((r) => (
                  <tr key={r.id} className={r.lowStock ? "bg-rose-50/40" : ""}>
                    <td className="px-4 py-2.5 font-semibold text-[var(--color-navy)]">{r.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-ink-soft)]">{r.sku}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.onHand} {r.unit}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-[var(--color-ink-muted)] tabular-nums">
                      {r.reorderThreshold ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!r.isActive ? (
                        <span className="rounded-full bg-[var(--color-cream-deep)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
                          Archived
                        </span>
                      ) : r.lowStock ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-800">
                          Low
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
