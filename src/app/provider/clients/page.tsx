import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { loadClients, findProviderForUser } from "@/lib/tenant-views";
import TenantClientsList from "@/components/TenantClientsList";

export const metadata: Metadata = { title: "Provider · My clients", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Provider's "my clients" — clients with at least one appointment under
 * this provider's id. Sorted by most-recent visit first. Search box on
 * top to find someone fast before walking into the consult.
 */
export default async function ProviderClientsPage() {
  const ctx = await requireTenantContext("tenant_provider");
  const provider = await findProviderForUser({
    tenantId: ctx.tenant.id,
    userEmail: ctx.user.email,
  });

  const clients = provider
    ? await loadClients({
        tenantId: ctx.tenant.id,
        treatedByProviderId: provider.id,
      })
    : [];

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Provider · My clients
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        My clients
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Everyone you&apos;ve treated, sorted by most-recent visit. Tap a client
        to pull up their full chart on the next page.
      </p>
      {!provider && (
        <div className="mt-6 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          We couldn&apos;t find a provider record matching your email. Ask your
          owner to create one on /owner/providers and link it to your account.
        </div>
      )}
      <div className="mt-6">
        <TenantClientsList
          clients={clients}
          emptyMessage={
            provider
              ? `${provider.full_name} hasn't treated any clients yet — your first booking will populate this list.`
              : "Provider record missing — see the note above."
          }
        />
      </div>
    </div>
  );
}
