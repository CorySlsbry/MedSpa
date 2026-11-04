import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/lib/tenant-context";
import { toDate } from "@/lib/firestore";
import { isStripeConfigured, TIER_DISPLAY } from "@/lib/stripe";
import BillingView from "@/components/owner/BillingView";
import ConnectCard from "@/components/owner/ConnectCard";
import UsageDashboard from "@/components/owner/UsageDashboard";

export const metadata: Metadata = {
  title: "Owner · Billing",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; connect?: string }>;
}) {
  const ctx = await requireTenantContext("tenant_owner");
  const sp = await searchParams;

  const tenant = ctx.tenant;
  const trialEndsAt = toDate(tenant.trial_ends_at);
  const trialDaysRemaining =
    trialEndsAt && tenant.subscription_status === "trialing"
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
      : null;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Billing
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Manage your Aesthera subscription. All payments processed by Stripe.
      </p>

      {sp.status === "success" && (
        <div className="mt-4 rounded-lg border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Subscription started — welcome aboard. The status above will update once Stripe
          confirms (usually within seconds).
        </div>
      )}
      {sp.status === "cancel" && (
        <div className="mt-4 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Checkout canceled — you can pick a plan whenever you&apos;re ready.
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-1">
          <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Current plan
            </div>
            <div className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)]">
              {TIER_DISPLAY[tenant.subscription_tier].name}
            </div>
            <div className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {TIER_DISPLAY[tenant.subscription_tier].price_display}
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <Row label="Status" value={statusBadge(tenant.subscription_status)} />
              {trialDaysRemaining !== null && (
                <Row
                  label="Trial"
                  value={`${trialDaysRemaining} day${trialDaysRemaining === 1 ? "" : "s"} left`}
                />
              )}
              <Row label="Stripe customer" value={tenant.stripe_customer_id ?? "—"} />
              <Row label="Stripe subscription" value={tenant.stripe_subscription_id ?? "—"} />
            </div>
            {tenant.stripe_customer_id && (
              <BillingView showPortalOnly />
            )}
          </div>
        </section>

        <section className="lg:col-span-2">
          {!isStripeConfigured() && (
            <div className="mb-4 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Stripe isn&apos;t configured yet. Once <code className="font-mono">STRIPE_SECRET_KEY</code> + price
              IDs are set in Cloud Run, plan upgrades will be live.
            </div>
          )}
          <BillingView
            currentTier={tenant.subscription_tier}
            stripeReady={isStripeConfigured()}
          />
          <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
            Questions? Email{" "}
            <Link href="mailto:hello@aesthera.io" className="underline">
              person1@example.com
            </Link>
            . Founding-25 pricing is locked in for life — first 25 clinics only.
          </p>
        </section>
      </div>

      <div className="mt-8">
        <ConnectCard
          initialConnected={!!tenant.stripe_connect_account_id}
          initialChargesEnabled={tenant.stripe_connect_charges_enabled}
          initialPayoutsEnabled={tenant.stripe_connect_payouts_enabled}
          initialDetailsSubmitted={tenant.stripe_connect_details_submitted}
          shouldRefresh={sp.connect === "return" || sp.connect === "refresh"}
        />
      </div>

      <div className="mt-8">
        <UsageDashboard />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] py-1.5 last:border-0">
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </span>
      <span className="text-sm font-medium text-[var(--color-navy)]">{value}</span>
    </div>
  );
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800",
    trialing: "bg-blue-100 text-blue-800",
    paused: "bg-amber-100 text-amber-800",
    cancelled: "bg-red-100 text-red-800",
  };
  const cls = colors[status] || "bg-gray-100 text-gray-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${cls}`}>
      {status}
    </span>
  );
}
