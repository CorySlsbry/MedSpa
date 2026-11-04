import type { ReactNode } from "react";
import { requireTenantContext } from "@/lib/tenant-context";
import TenantShell from "@/components/TenantShell";
import RoleAssistantWidget from "@/components/RoleAssistantWidget";

export const dynamic = "force-dynamic";

export default async function ManagerLayout({ children }: { children: ReactNode }) {
  const ctx = await requireTenantContext("tenant_manager");
  return (
    <TenantShell
      role="tenant_manager"
      user={{ email: ctx.user.email, displayName: ctx.user.displayName }}
      tenantName={ctx.tenant.name}
      isPreview={ctx.isPreview}
      menuOverrides={ctx.tenant.menu_overrides ?? null}
    >
      {children}
      <RoleAssistantWidget role="tenant_manager" />
    </TenantShell>
  );
}
