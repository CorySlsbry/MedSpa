import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import TeamView from "@/components/owner/TeamView";
import MenuConfigEditor from "@/components/owner/MenuConfigEditor";

export const metadata: Metadata = { title: "Manager · Team", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Manager team-management — same UI as the owner page, but the actorRole
 * is "tenant_manager" so the API gates promotion to/from owner. The
 * server-side role-change endpoint enforces this independently; the UI
 * just disables the disallowed options upfront.
 */
export default async function ManagerTeamPage() {
  const ctx = await requireTenantContext("tenant_manager");
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Team
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Manage the people who work at {ctx.tenant.name}. You can change roles
        for staff and clients, but only the owner can promote someone to owner.
      </p>
      <div className="mt-6">
        <TeamView
          actorRole="tenant_manager"
          tenantId={ctx.tenant.id}
          menuLockOwnerOnly={ctx.tenant.menu_lock_owner_only ?? false}
        />
      </div>
      <div className="mt-10">
        <MenuConfigEditor
          actorRole="tenant_manager"
          menuLockOwnerOnly={ctx.tenant.menu_lock_owner_only ?? false}
        />
      </div>
    </div>
  );
}
