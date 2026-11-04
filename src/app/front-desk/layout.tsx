import type { ReactNode } from "react";
import { requireTenantContext } from "@/lib/tenant-context";
import TenantShell from "@/components/TenantShell";
import RoleAssistantWidget from "@/components/RoleAssistantWidget";

export const dynamic = "force-dynamic";

export default async function FrontDeskLayout({ children }: { children: ReactNode }) {
  const ctx = await requireTenantContext("tenant_front_desk");
  return (
    <TenantShell
      role="tenant_front_desk"
      user={{ email: ctx.user.email, displayName: ctx.user.displayName }}
      tenantName={ctx.tenant.name}
      isPreview={ctx.isPreview}
      menuOverrides={ctx.tenant.menu_overrides ?? null}
    >
      {children}
      <RoleAssistantWidget role="tenant_front_desk" />
    </TenantShell>
  );
}
