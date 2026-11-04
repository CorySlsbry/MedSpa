"use client";

import { useEffect, useState } from "react";
import FriendlyErrorBanner from "@/components/FriendlyErrorBanner";

type Role =
  | "tenant_owner"
  | "tenant_manager"
  | "tenant_provider"
  | "tenant_front_desk"
  | "tenant_client";

const ROLE_LABEL: Record<Role, string> = {
  tenant_owner: "Owner",
  tenant_manager: "Manager",
  tenant_provider: "Provider",
  tenant_front_desk: "Front Desk",
  tenant_client: "Client",
};

const ROLES: Role[] = [
  "tenant_owner",
  "tenant_manager",
  "tenant_provider",
  "tenant_front_desk",
  "tenant_client",
];

/**
 * Static list of routes that owners + managers can re-assign. Mirrors the
 * NAV_BY_ROLE in TenantShell.tsx — when we add a new menu item, add it
 * here too so it shows up in the editor. Each entry's `defaultRoles` is
 * who sees it out of the box; users can flip checkboxes to add/remove
 * roles. Removing all roles hides the item from the sidebar.
 */
const ASSIGNABLE_ITEMS: { href: string; label: string; defaultRoles: Role[] }[] = [
  // Manager-default items — most operational stuff
  { href: "/manager/team", label: "Team", defaultRoles: ["tenant_manager"] },
  { href: "/manager/schedule", label: "Schedule (manager)", defaultRoles: ["tenant_manager"] },
  { href: "/manager/clients", label: "Clients (manager)", defaultRoles: ["tenant_manager"] },
  { href: "/manager/appointments", label: "Appointments (manager)", defaultRoles: ["tenant_manager"] },
  { href: "/manager/inbox", label: "Inbox (manager)", defaultRoles: ["tenant_manager"] },
  { href: "/manager/complaints", label: "Complaints", defaultRoles: ["tenant_manager"] },
  { href: "/manager/inventory", label: "Inventory (manager)", defaultRoles: ["tenant_manager"] },
  { href: "/manager/reports", label: "Reports (manager)", defaultRoles: ["tenant_manager"] },
  // Front-desk-default items
  { href: "/front-desk/check-in", label: "Check-in", defaultRoles: ["tenant_front_desk"] },
  { href: "/front-desk/schedule", label: "Schedule (front desk)", defaultRoles: ["tenant_front_desk"] },
  { href: "/front-desk/clients", label: "Clients (front desk)", defaultRoles: ["tenant_front_desk"] },
  { href: "/front-desk/inbox", label: "Inbox (front desk)", defaultRoles: ["tenant_front_desk"] },
  { href: "/front-desk/waitlist", label: "Waitlist", defaultRoles: ["tenant_front_desk"] },
  // Provider-default items
  { href: "/provider/schedule", label: "Schedule (provider)", defaultRoles: ["tenant_provider"] },
  { href: "/provider/clients", label: "My clients", defaultRoles: ["tenant_provider"] },
];

type ActorRole = "tenant_owner" | "tenant_manager";

export default function MenuConfigEditor({
  actorRole,
  menuLockOwnerOnly,
}: {
  actorRole: ActorRole;
  menuLockOwnerOnly: boolean;
}) {
  const [overrides, setOverrides] = useState<Record<string, Role[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch("/api/owner/menu-config");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't load the menu configuration.");
        return;
      }
      setOverrides((body.menu_overrides ?? {}) as Record<string, Role[]>);
      setLoaded(true);
    } catch (err) {
      setError(err);
    }
  }

  function rolesForItem(href: string): Role[] {
    if (overrides[href]) return overrides[href];
    return ASSIGNABLE_ITEMS.find((i) => i.href === href)?.defaultRoles ?? [];
  }

  function toggleRole(href: string, role: Role) {
    if (locked) return;
    const current = rolesForItem(href);
    const next = current.includes(role)
      ? current.filter((r) => r !== role)
      : [...current, role];
    setOverrides((prev) => ({ ...prev, [href]: next }));
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/owner/menu-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu_overrides: overrides }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't save the menu configuration.");
        return;
      }
      setToast("Menu visibility saved. Reload tenant portals to see the change.");
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  function resetOne(href: string) {
    if (locked) return;
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[href];
      return next;
    });
  }

  const locked = menuLockOwnerOnly && actorRole !== "tenant_owner";

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
      <div className="border-b border-[var(--color-line)] px-5 py-3">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
              Menu visibility
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
              Decide which roles see which menu items. A clinic that wants
              Inventory handled by the front desk can add tenant_front_desk to
              the Inventory line. Owners always see everything they own.
            </p>
          </div>
          {locked && (
            <span className="rounded-full bg-[var(--color-cream-deep)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Locked by owner
            </span>
          )}
        </div>
      </div>

      {error !== null && <div className="px-5 pt-4"><FriendlyErrorBanner error={error} /></div>}
      {toast && (
        <div className="mx-5 mt-4 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {toast}
        </div>
      )}

      {!loaded ? (
        <div className="px-5 py-6 text-sm text-[var(--color-ink-muted)]">Loading menu config…</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                <tr className="border-b border-[var(--color-line)]">
                  <th className="px-5 py-2.5">Menu item</th>
                  {ROLES.map((r) => (
                    <th key={r} className="px-3 py-2.5 text-center">
                      {ROLE_LABEL[r]}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right">Reset</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {ASSIGNABLE_ITEMS.map((item) => {
                  const current = rolesForItem(item.href);
                  const isOverridden = !!overrides[item.href];
                  return (
                    <tr key={item.href}>
                      <td className="px-5 py-2.5">
                        <div className="font-mono text-xs text-[var(--color-navy)]">
                          {item.href}
                        </div>
                        <div className="text-[11px] text-[var(--color-ink-muted)]">
                          {item.label}
                          {isOverridden && (
                            <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
                              custom
                            </span>
                          )}
                        </div>
                      </td>
                      {ROLES.map((r) => (
                        <td key={r} className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            disabled={locked}
                            checked={current.includes(r)}
                            onChange={() => toggleRole(item.href, r)}
                            className="h-4 w-4 cursor-pointer accent-[var(--color-teal)]"
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right">
                        {isOverridden && !locked && (
                          <button
                            type="button"
                            onClick={() => resetOne(item.href)}
                            className="text-[10px] font-semibold text-[var(--color-teal)] hover:underline"
                          >
                            Default
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[var(--color-line)] px-5 py-3">
            <button
              type="button"
              onClick={save}
              disabled={pending || locked}
              className="rounded-md bg-[var(--color-navy)] px-4 py-2 text-sm font-semibold text-[var(--color-cream)] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save menu visibility"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
