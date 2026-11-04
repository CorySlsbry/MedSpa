"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Sidebar nav for the /admin shell. Renders the active state from
 * `usePathname()` rather than a server-rendered prop so it tracks
 * client-side navigation correctly — App Router caches the parent layout
 * across sibling-segment navigation, which makes server-rendered active
 * state go stale otherwise.
 */
export default function AdminSidebarNav({
  items,
}: {
  items: { href: string; label: string }[];
}) {
  const pathname = usePathname() ?? "/admin";

  return (
    <nav aria-label="Admin navigation" className="flex-1 px-3 py-4 space-y-1">
      {items.map((item) => {
        // The Dashboard item (/admin) is only active on an exact match.
        // Everything else uses prefix match so deep pages (e.g.
        // /admin/workflows/[id]) keep the parent item highlighted.
        const isActive =
          item.href === "/admin"
            ? pathname === "/admin"
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
