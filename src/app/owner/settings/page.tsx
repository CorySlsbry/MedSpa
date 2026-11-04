import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { toDate } from "@/lib/firestore";
import SettingsView from "@/components/owner/SettingsView";
import IntegrationsView from "@/components/owner/IntegrationsView";

export const metadata: Metadata = {
  title: "Owner · Settings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type TenantSettings = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  primaryColor: string | null;
  logoUrl: string | null;
  twilioPhoneNumber: string | null;
  twilioSubaccountSid: string | null;
  googleReviewUrl: string | null;
  subscriptionTier: string;
  subscriptionStatus: string;
  trialEndsAt: Date | null;
  ownerEmail: string;
  hipaaBaaSignedAt: Date | null;
  createdAt: Date | null;
};

export default async function SettingsPage() {
  const ctx = await requireTenantContext("tenant_owner");
  const settings: TenantSettings = {
    id: ctx.tenant.id,
    name: ctx.tenant.name,
    slug: ctx.tenant.slug,
    timezone: ctx.tenant.timezone,
    primaryColor: ctx.tenant.primary_color,
    logoUrl: ctx.tenant.logo_url,
    twilioPhoneNumber: ctx.tenant.twilio_phone_number ?? null,
    twilioSubaccountSid: ctx.tenant.twilio_subaccount_sid ?? null,
    googleReviewUrl: ctx.tenant.google_review_url ?? null,
    subscriptionTier: ctx.tenant.subscription_tier,
    subscriptionStatus: ctx.tenant.subscription_status,
    trialEndsAt: toDate(ctx.tenant.trial_ends_at),
    ownerEmail: ctx.tenant.owner_email,
    hipaaBaaSignedAt: toDate(ctx.tenant.hipaa_baa_signed_at),
    createdAt: toDate(ctx.tenant.created_at),
  };

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Settings
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Tenant info, branding, and billing. Subscription tier and HIPAA BAA
        status are managed by Aesthera support.
      </p>

      <div className="mt-6 space-y-6">
        <SettingsView initial={settings} />
        <IntegrationsView />
      </div>
    </div>
  );
}
