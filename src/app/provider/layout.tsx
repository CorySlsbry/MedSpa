import type { ReactNode } from "react";
import { requireTenantContext } from "@/lib/tenant-context";
import TenantShell from "@/components/TenantShell";
import RoleAssistantWidget from "@/components/RoleAssistantWidget";

export const dynamic = "force-dynamic";

export default async function ProviderLayout({ children }: { children: ReactNode }) {
  const ctx = await requireTenantContext("tenant_provider");
  return (
    <TenantShell
      role="tenant_provider"
      user={{ email: ctx.user.email, displayName: ctx.user.displayName }}
      tenantName={ctx.tenant.name}
      isPreview={ctx.isPreview}
      menuOverrides={ctx.tenant.menu_overrides ?? null}
    >
      {children}
      <RoleAssistantWidget role="tenant_provider" />
    </TenantShell>
  );
}
