"use client";

import { useEffect, useState } from "react";

type ConnectStatus = {
  ok: boolean;
  connected: boolean;
  account_id?: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
};

export default function ConnectCard({
  initialConnected,
  initialChargesEnabled,
  initialPayoutsEnabled,
  initialDetailsSubmitted,
  shouldRefresh,
}: {
  initialConnected: boolean;
  initialChargesEnabled: boolean;
  initialPayoutsEnabled: boolean;
  initialDetailsSubmitted: boolean;
  shouldRefresh: boolean;
}) {
  const [status, setStatus] = useState<ConnectStatus>({
    ok: true,
    connected: initialConnected,
    charges_enabled: initialChargesEnabled,
    payouts_enabled: initialPayoutsEnabled,
    details_submitted: initialDetailsSubmitted,
  });
  const [busy, setBusy] = useState<"onboard" | "dashboard" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shouldRefresh) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRefresh]);

  async function refresh() {
    setBusy("refresh");
    setError(null);
    try {
      const res = await fetch("/api/owner/connect/status");
      const body = (await res.json()) as ConnectStatus;
      if (!res.ok) {
        setError("error" in body ? String(body.error) : "Could not refresh.");
        setBusy(null);
        return;
      }
      setStatus(body);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  async function startOnboarding() {
    setBusy("onboard");
    setError(null);
    try {
      const res = await fetch("/api/owner/connect/onboard", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body?.url) {
        setError(body?.error || "Could not start onboarding.");
        setBusy(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Network error.");
      setBusy(null);
    }
  }

  async function openDashboard() {
    setBusy("dashboard");
    setError(null);
    try {
      const res = await fetch("/api/owner/connect/dashboard", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body?.url) {
        setError(body?.error || "Could not open dashboard.");
        setBusy(null);
        return;
      }
      window.open(body.url, "_blank", "noopener");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  const isLive = status.connected && status.charges_enabled && status.payouts_enabled;
  const isPending = status.connected && status.details_submitted && !status.charges_enabled;
  const isIncomplete = status.connected && !status.details_submitted;
  const notStarted = !status.connected;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-[var(--color-paper)] p-6 shadow-sm ${
        isLive ? "border-[var(--color-gold)]" : "border-[var(--color-line)]"
      }`}
    >
      {/* Subtle gold sheen when live */}
      {isLive && (
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            background:
              "radial-gradient(circle at top right, var(--color-gold), transparent 60%)",
          }}
        />
      )}

      <div className="relative flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Client payments — Stripe Connect
            </span>
            <StatusPill
              status={
                isLive
                  ? "live"
                  : isPending
                  ? "pending"
                  : isIncomplete
                  ? "incomplete"
                  : "off"
              }
            />
          </div>
          <h2 className="mt-2 font-display text-xl font-bold text-[var(--color-navy)]">
            {isLive
              ? "You're live"
              : isPending
              ? "Stripe is reviewing your account"
              : isIncomplete
              ? "Finish onboarding"
              : "Accept card payments from your clients"}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            {isLive
              ? "Charge clients for visits, deposits, packages, gift cards, and tips. Funds settle to your bank daily."
              : isPending
              ? "Stripe typically clears new accounts within a few hours. Refresh to check status."
              : isIncomplete
              ? "Pick up where you left off — Stripe needs your business details and bank info."
              : "Set up payouts in ~5 minutes. Stripe handles KYC, you keep your bank details private."}
          </p>
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-3 gap-3 text-xs">
        <Capability label="KYC submitted" on={status.details_submitted} />
        <Capability label="Charges enabled" on={status.charges_enabled} />
        <Capability label="Payouts enabled" on={status.payouts_enabled} />
      </div>

      <div className="relative mt-5 flex flex-wrap items-center gap-2">
        {notStarted && (
          <button
            type="button"
            onClick={startOnboarding}
            disabled={busy !== null}
            className="rounded-lg bg-[var(--color-navy)] px-4 py-2 text-sm font-semibold text-[var(--color-cream)] transition hover:bg-[var(--color-navy-deep)] disabled:cursor-wait disabled:opacity-60"
          >
            {busy === "onboard" ? "Connecting…" : "Connect Stripe"}
          </button>
        )}
        {isIncomplete && (
          <button
            type="button"
            onClick={startOnboarding}
            disabled={busy !== null}
            className="rounded-lg bg-[var(--color-navy)] px-4 py-2 text-sm font-semibold text-[var(--color-cream)] transition hover:bg-[var(--color-navy-deep)] disabled:cursor-wait disabled:opacity-60"
          >
            {busy === "onboard" ? "Opening…" : "Resume onboarding"}
          </button>
        )}
        {(isPending || isLive) && (
          <button
            type="button"
            onClick={openDashboard}
            disabled={busy !== null || !status.charges_enabled}
            className="rounded-lg border border-[var(--color-navy)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--color-navy)] transition hover:bg-[var(--color-cream-deep)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "dashboard" ? "Opening…" : "Manage payouts →"}
          </button>
        )}
        {status.connected && (
          <button
            type="button"
            onClick={refresh}
            disabled={busy !== null}
            className="rounded-lg border border-[var(--color-line)] bg-transparent px-3 py-2 text-xs font-semibold text-[var(--color-ink-soft)] transition hover:bg-[var(--color-cream-deep)] disabled:opacity-60"
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh status"}
          </button>
        )}
      </div>

      {error && (
        <div className="relative mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}

      {isLive && (
        <p className="relative mt-4 text-[11px] text-[var(--color-ink-muted)]">
          Standard processing: 2.9% + 30¢ to Stripe + Aesthera platform fee. Funds payout daily to your bank account.
        </p>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: "live" | "pending" | "incomplete" | "off" }) {
  const palette: Record<typeof status, { label: string; cls: string }> = {
    live: { label: "Live", cls: "bg-emerald-100 text-emerald-800" },
    pending: { label: "Pending review", cls: "bg-blue-100 text-blue-800" },
    incomplete: { label: "Incomplete", cls: "bg-amber-100 text-amber-900" },
    off: { label: "Not connected", cls: "bg-gray-100 text-gray-700" },
  };
  const p = palette[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${p.cls}`}>
      {p.label}
    </span>
  );
}

function Capability({ label, on }: { label: string; on: boolean }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        on
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-[var(--color-line)] bg-[var(--color-cream)]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-2 w-2 rounded-full ${on ? "bg-emerald-500" : "bg-gray-300"}`}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
          {label}
        </span>
      </div>
      <div className={`mt-1 text-xs font-bold ${on ? "text-emerald-700" : "text-[var(--color-ink-muted)]"}`}>
        {on ? "Yes" : "Pending"}
      </div>
    </div>
  );
}
