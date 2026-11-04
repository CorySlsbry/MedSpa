import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import TeamView from "@/components/owner/TeamView";
import MenuConfigEditor from "@/components/owner/MenuConfigEditor";

export const metadata: Metadata = { title: "Owner · Team", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Team management — list staff, change roles, view 2FA / last sign-in.
 * Available to owners (full control) and managers (cannot promote owners
 * or touch the existing owner). Shared component, server-driven role
 * gate decides which buttons render.
 */
export default async function OwnerTeamPage() {
  const ctx = await requireTenantContext("tenant_owner");
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Team
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Manage the people who work at {ctx.tenant.name}. Change roles, see who&apos;s
        signed in recently, and configure who has access to what.
      </p>
      <div className="mt-6">
        <TeamView
          actorRole="tenant_owner"
          tenantId={ctx.tenant.id}
          menuLockOwnerOnly={ctx.tenant.menu_lock_owner_only ?? false}
        />
      </div>
      <div className="mt-10">
        <MenuConfigEditor
          actorRole="tenant_owner"
          menuLockOwnerOnly={ctx.tenant.menu_lock_owner_only ?? false}
        />
      </div>
    </div>
  );
}
