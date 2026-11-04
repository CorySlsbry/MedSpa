"use client";

import { useEffect, useState } from "react";
import FriendlyErrorBanner from "@/components/FriendlyErrorBanner";

type Role =
  | "tenant_owner"
  | "tenant_manager"
  | "tenant_provider"
  | "tenant_front_desk"
  | "tenant_client";

type ActorRole = "tenant_owner" | "tenant_manager" | "tenant_provider";

type User = {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  status: string;
  mfaEnrolled: boolean;
  lastSeenAt: string | null;
  createdAt: string | null;
};

const ROLE_LABEL: Record<Role, string> = {
  tenant_owner: "Owner",
  tenant_manager: "Manager",
  tenant_provider: "Provider",
  tenant_front_desk: "Front Desk",
  tenant_client: "Client",
};

const ROLE_COLOR: Record<Role, string> = {
  tenant_owner: "bg-[var(--color-gold)]/20 text-[var(--color-gold-deep)]",
  tenant_manager: "bg-sky-100 text-sky-800",
  tenant_provider: "bg-emerald-100 text-emerald-800",
  tenant_front_desk: "bg-purple-100 text-purple-800",
  tenant_client: "bg-[var(--color-cream-deep)] text-[var(--color-ink-muted)]",
};

const ALL_ROLES: Role[] = [
  "tenant_owner",
  "tenant_manager",
  "tenant_provider",
  "tenant_front_desk",
  "tenant_client",
];

function canActorChange(actor: ActorRole, currentRole: Role, newRole: Role): boolean {
  if (actor === "tenant_owner") return true;
  if (actor === "tenant_manager") {
    if (currentRole === "tenant_owner") return false;
    if (newRole === "tenant_owner") return false;
    return true;
  }
  // provider can only promote a client to front_desk
  return currentRole === "tenant_client" && newRole === "tenant_front_desk";
}

export default function TeamView({
  actorRole,
  tenantId,
  menuLockOwnerOnly,
}: {
  actorRole: ActorRole;
  tenantId: string;
  menuLockOwnerOnly: boolean;
}) {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [lockToggle, setLockToggle] = useState(menuLockOwnerOnly);
  const [lockPending, setLockPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/owner/team");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't load the team list.");
        return;
      }
      setUsers(body.users as User[]);
    } catch (err) {
      setError(err);
    }
  }

  async function changeRole(userId: string, newRole: Role) {
    setPending(userId);
    setError(null);
    try {
      const res = await fetch("/api/owner/team/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: userId, newRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't change the role.");
        return;
      }
      setToast(body.note ?? "Role updated.");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setPending(null);
    }
  }

  async function toggleMenuLock(next: boolean) {
    setLockPending(true);
    try {
      const res = await fetch("/api/owner/menu-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu_lock_owner_only: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't update the menu lock setting.");
        return;
      }
      setLockToggle(next);
      setToast(next ? "Menu editing locked to owners only." : "Menu editing now open to managers.");
    } catch (err) {
      setError(err);
    } finally {
      setLockPending(false);
    }
  }

  // The lock toggle is owner-only in the UI (tenants enforce server-side too)
  const canSeeLockToggle = actorRole === "tenant_owner";

  return (
    <div className="space-y-6">
      {error !== null && <FriendlyErrorBanner error={error} ctx="The team page" />}
      {toast && (
        <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {toast}
        </div>
      )}

      {canSeeLockToggle && (
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
                Menu lock
              </h2>
              <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                When ON, only the owner can move menu items between roles. Managers
                still see the team and can change roles, but they can&apos;t reshuffle
                what each role gets to do.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={lockToggle}
              disabled={lockPending}
              onClick={() => void toggleMenuLock(!lockToggle)}
              className={`flex h-7 w-12 shrink-0 items-center rounded-full transition ${
                lockToggle ? "bg-[var(--color-navy)] justify-end" : "bg-[var(--color-line)] justify-start"
              }`}
            >
              <span className="mx-0.5 h-6 w-6 rounded-full bg-white shadow" />
            </button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
        <div className="border-b border-[var(--color-line)] px-5 py-3">
          <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
            Staff &amp; clients
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            {users === null ? "Loading…" : `${users.length} ${users.length === 1 ? "user" : "users"}`}
          </p>
        </div>
        {users === null ? (
          <div className="px-5 py-6 text-sm text-[var(--color-ink-muted)]">Loading team…</div>
        ) : users.length === 0 ? (
          <div className="px-5 py-6 text-sm text-[var(--color-ink-muted)]">
            No users in this tenant yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <tr className="border-b border-[var(--color-line)]">
                <th className="px-5 py-2.5">User</th>
                <th className="px-5 py-2.5">Role</th>
                <th className="px-5 py-2.5">2FA</th>
                <th className="px-5 py-2.5">Last sign-in</th>
                <th className="px-5 py-2.5 text-right">Change role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="px-5 py-3">
                    <div className="font-semibold text-[var(--color-navy)]">
                      {u.displayName || u.email}
                    </div>
                    {u.displayName && (
                      <div className="text-[11px] text-[var(--color-ink-muted)]">{u.email}</div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${ROLE_COLOR[u.role]}`}>
                      {ROLE_LABEL[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {u.mfaEnrolled ? (
                      <span className="text-emerald-700">Enabled</span>
                    ) : (
                      <span className="text-amber-700">Off</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[11px] text-[var(--color-ink-muted)]">
                    {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <select
                      value={u.role}
                      disabled={pending === u.id}
                      onChange={(e) => {
                        const next = e.target.value as Role;
                        if (next === u.role) return;
                        const ok = window.confirm(
                          `Change ${u.displayName || u.email} from ${ROLE_LABEL[u.role]} to ${ROLE_LABEL[next]}?`,
                        );
                        if (ok) void changeRole(u.id, next);
                      }}
                      className="rounded-md border border-[var(--color-line)] bg-white px-2 py-1 text-xs"
                    >
                      {ALL_ROLES.map((r) => {
                        const allowed = canActorChange(actorRole, u.role, r);
                        return (
                          <option key={r} value={r} disabled={!allowed && r !== u.role}>
                            {ROLE_LABEL[r]}
                            {!allowed && r !== u.role ? " (not allowed)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-xs text-[var(--color-ink-muted)]">
        Role changes apply on the user&apos;s next sign-in (or after their current
        session refreshes — usually within an hour). They&apos;ll get bounced to the
        right portal automatically.
      </p>
    </div>
  );
}
