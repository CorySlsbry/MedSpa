"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Role =
  | "tenant_owner"
  | "tenant_manager"
  | "tenant_provider"
  | "tenant_front_desk"
  | "tenant_client";

/**
 * Tenant sidebar nav. Reads the active state from usePathname() so it
 * tracks client-side navigation correctly — App Router caches the parent
 * layout across sibling-segment navigation, so a server-rendered active
 * prop goes stale otherwise.
 *
 * Per-tenant menu overrides: the layout passes `menuOverrides` (read from
 * the tenant doc). For each item, if the override map has an entry for
 * that path, we render the item only if the current `role` is in the
 * override list. Items without overrides fall through to default
 * visibility (i.e., they show — TenantShell already filtered by role to
 * build `items`).
 */
export default function TenantSidebarNav({
  items,
  ariaLabel,
  role,
  menuOverrides,
}: {
  items: { href: string; label: string }[];
  ariaLabel: string;
  role: Role;
  /** Source field on TenantDoc allows the full UserRole union (incl.
   * super_admin), but only tenant roles can see this nav. Compare loosely. */
  menuOverrides?: Record<string, string[]> | null;
}) {
  const pathname = usePathname() ?? items[0]?.href ?? "/";
  const homeHref = items[0]?.href ?? "/";

  const visible = items.filter((item) => {
    const override = menuOverrides?.[item.href];
    if (!override) return true; // no override → default visibility (already role-scoped)
    return override.includes(role);
  });

  return (
    <nav aria-label={ariaLabel} className="flex-1 px-3 py-4 space-y-1">
      {visible.map((item) => {
        const isActive =
          item.href === homeHref
            ? pathname === homeHref
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
              isActive
                ? "bg-[var(--color-navy)] font-semibold text-[var(--color-cream)]"
                : "text-[var(--color-ink)] hover:bg-[var(--color-cream-deep)]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isActive ? "bg-[var(--color-gold)]" : "bg-[var(--color-teal)]"
              }`}
              aria-hidden="true"
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
