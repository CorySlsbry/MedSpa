"use client";

import { useEffect, useState } from "react";

type SeedUser = {
  email: string;
  fullName: string;
  role: "tenant_owner" | "tenant_manager" | "tenant_provider" | "tenant_front_desk";
  password: string;
};

type Status =
  | { exists: false }
  | {
      exists: true;
      slug: string;
      name: string;
      credentials: SeedUser[];
      counts: Record<string, number>;
    };

const ROLE_LABEL: Record<SeedUser["role"], string> = {
  tenant_owner: "Owner",
  tenant_manager: "Manager",
  tenant_provider: "Provider",
  tenant_front_desk: "Front Desk",
};

export default function DemoModeView() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<"seed" | "teardown" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/admin/demo/status");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't load demo status.");
        return;
      }
      if (!body.exists) setStatus({ exists: false });
      else
        setStatus({
          exists: true,
          slug: body.slug,
          name: body.name,
          credentials: body.credentials ?? [],
          counts: body.counts ?? {},
        });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function seed() {
    if (pending) return;
    setPending("seed");
    setError(null);
    setToast(null);
    try {
      const res = await fetch("/api/admin/demo/seed", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Seed failed.");
        return;
      }
      setToast(
        body.already
          ? "Demo tenant already existed — credentials reloaded."
          : `Demo tenant provisioned. Created ${body.counts?.users ?? 0} users + ${body.counts?.appointments ?? 0} appointments.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setPending(null);
    }
  }

  async function teardown() {
    if (pending) return;
    const ok = window.confirm(
      "Tear down the demo tenant? This deletes the tenant doc, every subcollection, all 6 demo Firebase users, and all demo leads. Idempotent — safe to re-run.",
    );
    if (!ok) return;
    setPending("teardown");
    setError(null);
    setToast(null);
    try {
      const res = await fetch("/api/admin/demo/teardown", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Teardown failed.");
        return;
      }
      setToast(
        `Demo torn down. Removed ${body.deleted_users} users + ${body.deleted_leads} leads.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setPending(null);
    }
  }

  async function previewAs(role: SeedUser["role"]) {
    if (!status?.exists) return;
    try {
      const res = await fetch("/api/admin/preview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, tenantId: status.slug }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't start preview.");
        return;
      }
      window.location.href = body.redirect ?? "/owner";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Demo mode
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Spin up a fully-populated enterprise-tier mock Med Spa to demo every
        role. Two locations, six staff members, ~115 appointments across the
        last 60 + next 14 days, ~40 leads, ~60 campaign runs, and a stocked
        product catalog. Once seeded, click <strong>Preview as</strong> on any
        role to step into that user&apos;s exact view.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}
      {toast && (
        <div className="mt-4 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {toast}
        </div>
      )}

      <section className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        {status === null ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Loading status…</p>
        ) : !status.exists ? (
          <div>
            <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
              No demo tenant active
            </h2>
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              Click below to provision the demo. Takes ~30 seconds — creates the
              tenant, 6 Firebase Auth users (1 owner + 1 manager + 2 providers +
              2 front-desk), 2 locations, ~12 services, ~7 products, ~35 clients,
              ~115 appointments, ~30 charts, ~40 leads, and ~60 campaign runs.
            </p>
            <ul className="mt-4 space-y-1 text-xs text-[var(--color-ink-muted)]">
              <li>• Tenant subscription: <strong>Enterprise</strong> (every feature unlocked)</li>
              <li>• Email domain: <code className="rounded bg-[var(--color-cream-deep)] px-1 font-mono">demo.aesthera.io</code></li>
              <li>• Photos are skipped — gallery shows empty (real photo bytes would require GCS upload)</li>
              <li>• No real Stripe Connect — Billing page surfaces unconfigured state</li>
            </ul>
            <button
              type="button"
              onClick={() => void seed()}
              disabled={pending !== null}
              className="mt-5 rounded-md bg-[var(--color-navy)] px-4 py-2 text-sm font-semibold text-[var(--color-cream)] disabled:opacity-50"
            >
              {pending === "seed" ? "Seeding…" : "Provision demo tenant"}
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
                  {status.name}
                </h2>
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                  Slug: <code className="font-mono">{status.slug}</code> · Subscription:{" "}
                  <span className="font-semibold text-[var(--color-gold-deep)]">Enterprise</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void teardown()}
                disabled={pending !== null}
                className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
              >
                {pending === "teardown" ? "Tearing down…" : "Tear down demo"}
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              {Object.entries(status.counts).map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 p-3"
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
                    {k.replace(/_/g, " ")}
                  </div>
                  <div className="mt-1 font-display text-xl font-bold text-[var(--color-navy)] tabular-nums">
                    {v}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <h3 className="font-display text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Step into a role
              </h3>
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                One click puts you in that user&apos;s exact view via the View-as
                cookie. Your super-admin session stays active in the background.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {status.credentials.map((u) => (
                  <button
                    key={u.email}
                    type="button"
                    onClick={() => void previewAs(u.role)}
                    className="group flex items-center justify-between rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2.5 text-left transition hover:border-[var(--color-gold)]"
                  >
                    <div>
                      <div className="text-sm font-semibold text-[var(--color-navy)]">
                        {u.fullName}
                      </div>
                      <div className="text-[10px] text-[var(--color-ink-muted)]">
                        {ROLE_LABEL[u.role]} · {u.email}
                      </div>
                    </div>
                    <span className="text-xs text-[var(--color-teal)] opacity-0 transition group-hover:opacity-100">
                      Preview →
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
                Demo credentials
              </div>
              <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
                Use these to sign in directly as a demo user. Click any password
                to copy. <strong>Do not share publicly</strong> — these grant
                tenant access.
              </p>
              <table className="mt-3 w-full text-xs">
                <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                  <tr>
                    <th className="py-1">Role</th>
                    <th className="py-1">Email</th>
                    <th className="py-1">Password</th>
                  </tr>
                </thead>
                <tbody>
                  {status.credentials.map((u) => (
                    <tr key={u.email} className="border-t border-[var(--color-line)]">
                      <td className="py-1.5">{ROLE_LABEL[u.role]}</td>
                      <td className="py-1.5 font-mono text-[10px]">{u.email}</td>
                      <td className="py-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(u.password);
                            setToast(`Password for ${u.email} copied.`);
                          }}
                          className="rounded bg-[var(--color-cream-deep)] px-2 py-0.5 font-mono text-[10px] hover:bg-[var(--color-cream)]"
                        >
                          {u.password}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
