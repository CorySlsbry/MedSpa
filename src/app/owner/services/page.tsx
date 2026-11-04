import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import { TIER_LIMITS } from "@/lib/tier-limits";
import ServicesView from "@/components/owner/ServicesView";
import type {
  ServiceDoc,
  ServiceCategory,
  ServiceConsumes,
  ProductDoc,
} from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Owner · Services",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type ServiceRow = {
  id: string;
  name: string;
  category: ServiceCategory;
  durationMinutes: number;
  priceCents: number | null;
  description: string | null;
  isActive: boolean;
  consumes: ServiceConsumes[];
  depositCents: number | null;
  recommendedRebookDays: number | null;
  createdAt: Date | null;
};

export type ProductOption = {
  id: string;
  name: string;
  unit: string;
};

async function loadServices(tenantId: string): Promise<ServiceRow[]> {
  const snap = await tenantCol(tenantId, "services")
    .orderBy("created_at", "desc")
    .limit(200)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as ServiceDoc;
    return {
      id: d.id,
      name: data.name,
      category: data.category,
      durationMinutes: data.duration_minutes,
      priceCents: data.price_cents,
      description: data.description,
      isActive: data.is_active,
      consumes: data.consumes ?? [],
      depositCents: data.deposit_cents ?? null,
      recommendedRebookDays: data.recommended_rebook_days ?? null,
      createdAt: toDate(data.created_at),
    };
  });
}

async function loadProducts(tenantId: string): Promise<ProductOption[]> {
  const snap = await tenantCol(tenantId, "products")
    .where("is_active", "==", true)
    .orderBy("name", "asc")
    .limit(500)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const p = d.data() as ProductDoc;
    return { id: d.id, name: p.name, unit: p.unit };
  });
}

export default async function ServicesPage() {
  const ctx = await requireTenantContext("tenant_owner");
  const inventoryEnabled =
    TIER_LIMITS[ctx.tenant.subscription_tier].features.inventory;
  let rows: ServiceRow[] = [];
  let products: ProductOption[] = [];
  let errorMsg: string | null = null;
  try {
    rows = await loadServices(ctx.tenant.id);
    if (inventoryEnabled) {
      products = await loadProducts(ctx.tenant.id);
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Services
        </h1>
        <span className="text-sm text-[var(--color-ink-muted)]">
          {rows.filter((r) => r.isActive).length} active
        </span>
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Your service catalog. Each service has a duration and (optional)
        price. Used when scheduling appointments.
      </p>

      {errorMsg && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {errorMsg}
        </div>
      )}

      <div className="mt-6">
        <ServicesView
          initialRows={rows}
          products={products}
          inventoryEnabled={inventoryEnabled}
        />
      </div>
    </div>
  );
}
