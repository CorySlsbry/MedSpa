import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/lib/tenant-context";
import { loadAppointments, findProviderForUser } from "@/lib/tenant-views";
import TenantAppointmentsList from "@/components/TenantAppointmentsList";

export const metadata: Metadata = {
  title: "Provider · Today",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Provider's "today" home — first thing they see when they sign in.
 * Reads the provider's own appointments via the ProviderDoc whose email
 * matches the session, then renders them via the shared
 * TenantAppointmentsList. Action cards link to the working features
 * (Charts, My clients, Schedule) — no more misleading "coming soon."
 */
export default async function ProviderTodayPage() {
  const ctx = await requireTenantContext("tenant_provider");
  const provider = await findProviderForUser({
    tenantId: ctx.tenant.id,
    userEmail: ctx.user.email,
  });

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const today = provider
    ? await loadAppointments({
        tenantId: ctx.tenant.id,
        fromMs: start.getTime(),
        toMs: end.getTime(),
        providerId: provider.id,
      })
    : [];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Today
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Welcome back, {provider?.full_name || ctx.user.displayName || ctx.user.email}.{" "}
        {today.length} {today.length === 1 ? "appointment" : "appointments"} on your schedule.
      </p>

      {!provider && (
        <div className="mt-6 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          We couldn&apos;t find a provider record matching your email. Ask your
          owner to create one on /owner/providers and link it to your account.
        </div>
      )}

      <div className="mt-6">
        <TenantAppointmentsList
          appointments={today}
          actorRole="tenant_provider"
          emptyMessage={
            provider
              ? "Nothing on your calendar today. Check Schedule for the rest of the week."
              : "Provider record missing — see the note above."
          }
        />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <ActionCard
          title="Charting + SOAP"
          description="Open a chart for any appointment — templates per service type, last-visit smart-fill, photo annotations, signatures."
          href="/provider/charts"
          cta="Open charts"
        />
        <ActionCard
          title="My clients"
          description="Everyone you've treated, sorted by most-recent visit. Search by name, email, phone, or tag."
          href="/provider/clients"
          cta="Open client list"
        />
        <ActionCard
          title="Full schedule"
          description="Next 7 days at a glance — see gaps the front desk can fill with walk-ins."
          href="/provider/schedule"
          cta="Open schedule"
        />
        <ActionCard
          title="Profile"
          description="Update your bio, profile photo, and which services you offer. Affects what clients see when they book."
          href="/provider/profile"
          cta="Edit profile"
        />
      </div>
    </div>
  );
}

function ActionCard({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 transition hover:border-[var(--color-gold)]">
      <h3 className="font-display text-base font-bold text-[var(--color-navy)]">{title}</h3>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{description}</p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-teal)] hover:underline"
      >
        {cta} →
      </Link>
    </div>
  );
}
