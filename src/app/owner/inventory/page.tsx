import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import { TIER_LIMITS } from "@/lib/tier-limits";
import InventoryView from "@/components/owner/InventoryView";
import type { ProductDoc } from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Owner · Inventory",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  onHand: number;
  reorderThreshold: number | null;
  costCentsPerUnit: number | null;
  supplier: string | null;
  notes: string | null;
  isActive: boolean;
  archivedAt: Date | null;
  lowStock: boolean;
  createdAt: Date | null;
};

async function loadProducts(tenantId: string): Promise<ProductRow[]> {
  const snap = await tenantCol(tenantId, "products")
    .orderBy("name", "asc")
    .limit(500)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const p = d.data() as ProductDoc;
    return {
      id: d.id,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      onHand: p.on_hand_quantity,
      reorderThreshold: p.reorder_threshold,
      costCentsPerUnit: p.cost_cents_per_unit,
      supplier: p.supplier,
      notes: p.notes,
      isActive: p.is_active,
      archivedAt: toDate(p.archived_at),
      lowStock:
        p.is_active &&
        p.reorder_threshold !== null &&
        p.reorder_threshold !== undefined &&
        p.on_hand_quantity <= p.reorder_threshold,
      createdAt: toDate(p.created_at),
    };
  });
}

export default async function InventoryPage() {
  const ctx = await requireTenantContext("tenant_owner");
  const inventoryEnabled = TIER_LIMITS[ctx.tenant.subscription_tier].features.inventory;

  let rows: ProductRow[] = [];
  let errorMsg: string | null = null;
  if (inventoryEnabled) {
    try {
      rows = await loadProducts(ctx.tenant.id);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Inventory
        </h1>
        {inventoryEnabled && (
          <span className="text-sm text-[var(--color-ink-muted)]">
            {rows.filter((r) => r.isActive).length} active SKUs
            {rows.filter((r) => r.lowStock).length > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-rose-700">
                  {rows.filter((r) => r.lowStock).length} low
                </span>
              </>
            )}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Track product stock — vials, syringes, retail items. Auto-deducts on
        chart sign when you link a product to a service.
      </p>

      {!inventoryEnabled && (
        <div className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-cream)] px-6 py-12 text-center">
          <h2 className="font-display text-xl font-bold text-[var(--color-navy)]">
            Upgrade to track inventory
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-soft)]">
            Inventory tracking is included on Basic, Growth, and Enterprise
            plans. Upgrade to start counting product usage and getting
            low-stock alerts.
          </p>
          <a
            href="/owner/billing"
            className="btn btn-gold mt-4 inline-block"
          >
            See plans
          </a>
        </div>
      )}

      {errorMsg && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {errorMsg}
        </div>
      )}

      {inventoryEnabled && (
        <div className="mt-6">
          <InventoryView initialRows={rows} />
        </div>
      )}
    </div>
  );
}
