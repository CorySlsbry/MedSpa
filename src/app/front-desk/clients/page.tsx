import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { loadClients } from "@/lib/tenant-views";
import TenantClientsList from "@/components/TenantClientsList";

export const metadata: Metadata = { title: "Front Desk · Clients", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Front-desk clients — searchable list of every client at the clinic.
 * Used to look someone up while they're on the phone or at the counter.
 * Read-only at this layer; clinical edits live on /provider/charts and
 * profile updates on /owner/clients/[id].
 */
export default async function FrontDeskClientsPage() {
  const ctx = await requireTenantContext("tenant_front_desk");
  const clients = await loadClients({ tenantId: ctx.tenant.id });

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Front Desk · Clients
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Clients
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Search any client by name, email, phone, or tag. {clients.length} on
        file at {ctx.tenant.name}.
      </p>
      <div className="mt-6">
        <TenantClientsList
          clients={clients}
          emptyMessage="No clients on file yet. They'll appear here as they book or get added by an owner."
        />
      </div>
    </div>
  );
}
