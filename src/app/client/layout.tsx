import type { ReactNode } from "react";
import { requireTenantContext } from "@/lib/tenant-context";
import TenantShell from "@/components/TenantShell";

export const dynamic = "force-dynamic";

export default async function ClientLayout({ children }: { children: ReactNode }) {
  const ctx = await requireTenantContext("tenant_client");
  return (
    <TenantShell
      role="tenant_client"
      user={{ email: ctx.user.email, displayName: ctx.user.displayName }}
      tenantName={ctx.tenant.name}
      isPreview={ctx.isPreview}
      menuOverrides={ctx.tenant.menu_overrides ?? null}
    >
      {children}
    </TenantShell>
  );
}
