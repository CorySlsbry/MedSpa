import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { limitsFor } from "@/lib/tier-limits";
import ConsentsView from "@/components/owner/ConsentsView";

export const metadata: Metadata = {
  title: "Owner · Consents",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ConsentsPage() {
  const ctx = await requireTenantContext("tenant_owner");
  const enabled = limitsFor(ctx.tenant).features.digital_consents;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Consent forms
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Build your clinic's consent templates, send signing links to clients,
        and download HIPAA-trail PDFs. Signatures are captured with IP +
        timestamp.
      </p>

      <div className="mt-6">
        {enabled ? (
          <ConsentsView />
        ) : (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
            Digital consents aren&apos;t included on your plan. Upgrade to enable.
          </div>
        )}
      </div>
    </div>
  );
}
