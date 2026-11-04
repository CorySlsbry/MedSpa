import Link from "next/link";
import type { ReactNode } from "react";
import SignOutButton from "./SignOutButton";
import AdminSidebarNav from "./AdminSidebarNav";
import AdminIdleTimer from "./AdminIdleTimer";
import ThemeToggle from "@/components/ThemeToggle";
import ThemePrePaintScript from "@/components/ThemePrePaintScript";

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/contacts", label: "Contacts" },
  { href: "/admin/companies", label: "Companies" },
  { href: "/admin/deals", label: "Deals" },
  { href: "/admin/tasks", label: "Tasks" },
  { href: "/admin/workflows", label: "Workflows" },
  { href: "/admin/tenants", label: "Tenants" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/replies", label: "Replies" },
  { href: "/admin/integrations", label: "Integrations" },
  { href: "/admin/email-monitor", label: "Email monitor" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/preview", label: "View as" },
  { href: "/admin/demo", label: "Demo mode" },
  { href: "/admin/security", label: "Security" },
];

export default function AdminShell({
  user,
  children,
}: {
  user: { email: string; displayName: string | null };
  children: ReactNode;
}) {
  return (
    <div className="aesthera-shell flex min-h-screen bg-[var(--color-cream)]">
      <ThemePrePaintScript scope="admin" />
      <aside className="hidden md:flex w-64 flex-col border-r border-[var(--color-line)] bg-[var(--color-paper)]">
        <div className="px-6 py-5 border-b border-[var(--color-line)]">
          <Link href="/admin" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-navy-deep)] font-display text-base font-bold text-[var(--color-gold)]">
              A
            </span>
            <div>
              <div className="font-display text-base font-bold tracking-tight text-[var(--color-navy)]">
                Aesthera
              </div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">
                Admin · CRM
              </div>
            </div>
          </Link>
        </div>
        <AdminSidebarNav items={NAV_ITEMS} />
        <div className="px-4 py-4 border-t border-[var(--color-line)] space-y-3">
          <div>
            <div className="text-xs text-[var(--color-ink-muted)]">Signed in</div>
            <div className="mt-1 truncate text-sm font-semibold text-[var(--color-navy)]">
              {user.displayName || user.email}
            </div>
          </div>
          <ThemeToggle scope="admin" />
          <SignOutButton />
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-navy-deep)] font-display text-sm font-bold text-[var(--color-gold)]">
              A
            </span>
            <span className="font-display text-sm font-bold text-[var(--color-navy)]">
              Aesthera Admin
            </span>
          </Link>
          <SignOutButton compact />
        </header>
        <main className="flex-1 px-5 py-6 md:px-10 md:py-10 max-w-6xl">{children}</main>
      </div>
      <AdminIdleTimer />
    </div>
  );
}
