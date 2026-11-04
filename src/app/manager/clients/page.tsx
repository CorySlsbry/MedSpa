import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { loadClients } from "@/lib/tenant-views";
import TenantClientsList from "@/components/TenantClientsList";

export const metadata: Metadata = { title: "Manager · Clients", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ManagerClientsPage() {
  const ctx = await requireTenantContext("tenant_manager");
  const clients = await loadClients({ tenantId: ctx.tenant.id });

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Manager · Clients
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Clients
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Every client at {ctx.tenant.name} — search by name, email, phone, or
        tag. Clinical history lives on the provider portal.
      </p>
      <div className="mt-6">
        <TenantClientsList
          clients={clients}
          emptyMessage="No clients on file yet."
        />
      </div>
    </div>
  );
}
