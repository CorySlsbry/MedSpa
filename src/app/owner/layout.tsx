import type { ReactNode } from "react";
import { requireTenantContext } from "@/lib/tenant-context";
import TenantShell from "@/components/TenantShell";
import RoleAssistantWidget from "@/components/RoleAssistantWidget";

export const dynamic = "force-dynamic";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const ctx = await requireTenantContext("tenant_owner");
  return (
    <TenantShell
      role="tenant_owner"
      user={{ email: ctx.user.email, displayName: ctx.user.displayName }}
      tenantName={ctx.tenant.name}
      isPreview={ctx.isPreview}
      menuOverrides={ctx.tenant.menu_overrides ?? null}
    >
      {children}
      <RoleAssistantWidget role="tenant_owner" />
    </TenantShell>
  );
}
