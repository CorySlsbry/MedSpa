import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireTenantContext } from "@/lib/tenant-context";
import OnboardingWizard from "@/components/owner/OnboardingWizard";

export const metadata: Metadata = {
  title: "Welcome to Aesthera",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const ctx = await requireTenantContext("tenant_owner");
  if (ctx.tenant.onboarded_at) {
    redirect("/owner");
  }
  return (
    <OnboardingWizard
      tenantName={ctx.tenant.name}
      tenantId={ctx.tenant.id}
      tenantTimezone={ctx.tenant.timezone}
      tenantPrimaryColor={ctx.tenant.primary_color}
      tenantLogoUrl={ctx.tenant.logo_url}
    />
  );
}
