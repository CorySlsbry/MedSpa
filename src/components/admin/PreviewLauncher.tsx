"use client";

import { useState } from "react";

type Tenant = { id: string; name: string; tier: string };
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

export default function PreviewLauncher({ tenants }: { tenants: Tenant[] }) {
  const [tenantId, setTenantId] = useState<string>(tenants[0]?.id ?? "");
  const [pending, setPending] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startPreview(role: Role) {
    if (!tenantId) {
      setError("Pick a tenant first.");
      return;
    }
    setPending(role);
    setError(null);
    try {
      const res = await fetch("/api/admin/preview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't start preview.");
        setPending(null);
        return;
      }
      window.location.href = body.redirect ?? "/owner";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setPending(null);
    }
  }

  return (
    <div className="mt-8">
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Tenant
          </span>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.tier.replace(/_/g, "-")}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            View as
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                disabled={pending !== null}
                onClick={() => void startPreview(r)}
                className="flex items-center justify-center rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 px-4 py-3 text-sm font-semibold text-[var(--color-navy)] transition hover:border-[var(--color-gold)] hover:bg-[var(--color-cream)] disabled:opacity-50"
              >
                {pending === r ? "Loading…" : ROLE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
