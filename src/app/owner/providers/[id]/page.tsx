import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import AvailabilityEditor from "@/components/owner/AvailabilityEditor";
import CalendarFeedCard from "@/components/owner/CalendarFeedCard";
import type { ProviderDoc } from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Owner · Provider",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenantContext("tenant_owner");
  const snap = await tenantCol(ctx.tenant.id, "providers").doc(id).get();
  if (!snap.exists) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)]">
          Provider not found
        </h1>
        <Link href="/owner/providers" className="text-sm text-[var(--color-teal-deep)] underline">
          ← Back to providers
        </Link>
      </div>
    );
  }
  const provider = snap.data() as ProviderDoc;

  return (
    <div>
      <Link
        href="/owner/providers"
        className="text-xs font-semibold text-[var(--color-ink-muted)] hover:underline"
      >
        ← Providers
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ background: provider.scheduling_color ?? "#b98f42" }}
        />
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          {provider.full_name}
        </h1>
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        {provider.title || "Provider"} ·{" "}
        {provider.is_active ? "Active" : "Inactive"}
      </p>

      <div className="mt-6 space-y-6">
        <AvailabilityEditor providerId={id} providerName={provider.full_name} />
        {provider.ics_token && (
          <CalendarFeedCard
            icsToken={provider.ics_token}
            providerName={provider.full_name}
          />
        )}
      </div>
    </div>
  );
}
