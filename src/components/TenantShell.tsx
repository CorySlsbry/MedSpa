import Link from "next/link";
import type { ReactNode } from "react";
import TenantSignOutButton from "./TenantSignOutButton";
import TenantSidebarNav from "./TenantSidebarNav";
import TenantIdleTimer from "./TenantIdleTimer";
import ThemeToggle from "./ThemeToggle";
import ThemePrePaintScript from "./ThemePrePaintScript";
import PreviewBanner from "./PreviewBanner";

type Role =
  | "tenant_owner"
  | "tenant_manager"
  | "tenant_provider"
  | "tenant_front_desk"
  | "tenant_client";

const NAV_BY_ROLE: Record<Role, { href: string; label: string }[]> = {
  tenant_owner: [
    { href: "/owner", label: "Dashboard" },
    { href: "/owner/locations", label: "Locations" },
    { href: "/owner/team", label: "Team" },
    { href: "/owner/providers", label: "Providers" },
    { href: "/owner/services", label: "Services" },
    { href: "/owner/clients", label: "Clients" },
    { href: "/owner/appointments", label: "Appointments" },
    { href: "/owner/waitlist", label: "Waitlist" },
    { href: "/owner/inbox", label: "Inbox" },
    { href: "/owner/consents", label: "Consents" },
    { href: "/owner/inventory", label: "Inventory" },
    { href: "/owner/memberships", label: "Memberships" },
    { href: "/owner/packages", label: "Packages" },
    { href: "/owner/marketing", label: "Marketing" },
    { href: "/owner/reports", label: "Reports" },
    { href: "/owner/billing", label: "Billing" },
    { href: "/owner/settings", label: "Settings" },
  ],
  tenant_manager: [
    { href: "/manager", label: "Dashboard" },
    { href: "/manager/team", label: "Team" },
    { href: "/manager/schedule", label: "Schedule" },
    { href: "/manager/clients", label: "Clients" },
    { href: "/manager/appointments", label: "Appointments" },
    { href: "/manager/inbox", label: "Inbox" },
    { href: "/manager/complaints", label: "Complaints" },
    { href: "/manager/inventory", label: "Inventory" },
    { href: "/manager/reports", label: "Reports" },
  ],
  tenant_provider: [
    { href: "/provider", label: "Today" },
    { href: "/provider/schedule", label: "Schedule" },
    { href: "/provider/clients", label: "My clients" },
    { href: "/provider/charts", label: "Charts" },
    { href: "/provider/profile", label: "Profile" },
  ],
  tenant_front_desk: [
    { href: "/front-desk", label: "Today" },
    { href: "/front-desk/check-in", label: "Check-in" },
    { href: "/front-desk/schedule", label: "Schedule" },
    { href: "/front-desk/clients", label: "Clients" },
    { href: "/front-desk/inbox", label: "Inbox" },
    { href: "/front-desk/waitlist", label: "Waitlist" },
  ],
  tenant_client: [
    { href: "/client", label: "Home" },
    { href: "/client/visits", label: "Visits" },
    { href: "/client/photos", label: "Photos" },
    { href: "/client/membership", label: "Membership" },
    { href: "/client/profile", label: "Profile" },
  ],
};

const ROLE_LABEL: Record<Role, string> = {
  tenant_owner: "Owner",
  tenant_manager: "Manager",
  tenant_provider: "Provider",
  tenant_front_desk: "Front desk",
  tenant_client: "Client",
};

export default function TenantShell({
  role,
  user,
  tenantName,
  isPreview,
  menuOverrides,
  children,
}: {
  role: Role;
  user: { email: string; displayName: string | null };
  tenantName: string;
  /** True when a super_admin is using View-as to inspect this layer.
   * Renders a sticky banner at the top with an Exit button. */
  isPreview?: boolean;
  /** Per-tenant menu visibility overrides — passed through to the sidebar
   * so a clinic can hide items for specific roles. Keys are absolute paths,
   * values are the roles that SHOULD see the item. Typed loosely as string[]
   * since the source field on TenantDoc allows the full UserRole union
   * (incl. super_admin) — the sidebar narrows to its visible Role set. */
  menuOverrides?: Record<string, string[]> | null;
  children: ReactNode;
}) {
  const nav = NAV_BY_ROLE[role];

  return (
    <div className="aesthera-shell flex min-h-screen flex-col bg-[var(--color-cream)]">
      <ThemePrePaintScript scope="tenant" />
      {isPreview && <PreviewBanner role={role} tenantName={tenantName} />}
      <div className="flex flex-1 min-h-0">
      <aside className="hidden md:flex w-64 flex-col border-r border-[var(--color-line)] bg-[var(--color-paper)]">
        <div className="px-6 py-5 border-b border-[var(--color-line)]">
          <Link href={nav[0].href} className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-navy-deep)] font-display text-base font-bold text-[var(--color-gold)]">
              A
            </span>
            <div>
              <div className="font-display text-base font-bold tracking-tight text-[var(--color-navy)]">
                {tenantName}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">
                {ROLE_LABEL[role]} portal
              </div>
            </div>
          </Link>
        </div>
        <TenantSidebarNav
          items={nav}
          ariaLabel={`${ROLE_LABEL[role]} navigation`}
          role={role}
          menuOverrides={menuOverrides}
        />
        <div className="px-4 py-4 border-t border-[var(--color-line)] space-y-3">
          <div>
            <div className="text-xs text-[var(--color-ink-muted)]">Signed in</div>
            <div className="mt-1 truncate text-sm font-semibold text-[var(--color-navy)]">
              {user.displayName || user.email}
            </div>
          </div>
          <ThemeToggle scope="tenant" />
          <TenantSignOutButton />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3">
          <Link href={nav[0].href} className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-navy-deep)] font-display text-sm font-bold text-[var(--color-gold)]">
              A
            </span>
            <span className="font-display text-sm font-bold text-[var(--color-navy)]">
              {tenantName}
            </span>
          </Link>
          <TenantSignOutButton compact />
        </header>
        <main className="flex-1 px-5 py-6 md:px-10 md:py-10 max-w-6xl">{children}</main>
      </div>
      </div>
      <TenantIdleTimer isPreview={isPreview} />
    </div>
  );
}
