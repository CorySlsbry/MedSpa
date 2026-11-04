import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { loadAppointments, findProviderForUser } from "@/lib/tenant-views";
import TenantAppointmentsList from "@/components/TenantAppointmentsList";

export const metadata: Metadata = { title: "Provider · Schedule", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Provider's personal schedule — only THIS provider's appointments,
 * scoped via the ProviderDoc associated with the user's email. Read-only;
 * scheduling lives on the front desk.
 */
export default async function ProviderSchedulePage() {
  const ctx = await requireTenantContext("tenant_provider");
  const provider = await findProviderForUser({
    tenantId: ctx.tenant.id,
    userEmail: ctx.user.email,
  });

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

  const appointments = provider
    ? await loadAppointments({
        tenantId: ctx.tenant.id,
        fromMs: start.getTime(),
        toMs: end.getTime(),
        providerId: provider.id,
        limit: 200,
      })
    : [];

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Provider · Schedule
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        {provider ? `${provider.full_name}'s schedule` : "Your schedule"}
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Your bookings for the next 7 days. Gaps in your day can be filled by
        the front desk with a walk-in.
      </p>
      {!provider && (
        <div className="mt-6 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          We couldn&apos;t find a provider record matching your email. Ask your
          owner to create one on /owner/providers and link it to your account.
        </div>
      )}
      <div className="mt-6">
        <TenantAppointmentsList
          appointments={appointments}
          actorRole="tenant_provider"
          emptyMessage={
            provider
              ? "No bookings on your calendar in the next 7 days."
              : "Your provider record is missing — see the note above."
          }
        />
      </div>
    </div>
  );
}
