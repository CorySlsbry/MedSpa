"use client";

import { useState } from "react";
import { TIER_DISPLAY } from "@/lib/stripe";
import type { TenantSubscriptionTier } from "@/lib/firestore-types";

const TIERS_IN_ORDER: TenantSubscriptionTier[] = [
  "founding_25",
  "basic",
  "growth",
  "enterprise",
];

export default function BillingView({
  currentTier,
  stripeReady,
  showPortalOnly,
}: {
  currentTier?: TenantSubscriptionTier;
  stripeReady?: boolean;
  showPortalOnly?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(tier: TenantSubscriptionTier) {
    setBusy(tier);
    setError(null);
    try {
      const res = await fetch("/api/owner/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const body = await res.json();
      if (!res.ok || !body?.url) {
        setError(body?.error || "Couldn't start checkout.");
        setBusy(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Network error.");
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    setError(null);
    try {
      const res = await fetch("/api/owner/billing/portal", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body?.url) {
        setError(body?.error || "Couldn't open the customer portal.");
        setBusy(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Network error.");
      setBusy(null);
    }
  }

  if (showPortalOnly) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={openPortal}
          disabled={busy === "portal"}
          className="w-full rounded-lg border border-[var(--color-navy)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-navy)] transition hover:bg-[var(--color-cream-deep)] disabled:opacity-60"
        >
          {busy === "portal" ? "Opening…" : "Manage in Stripe →"}
        </button>
        {error && (
          <div className="mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        {TIERS_IN_ORDER.map((tier) => {
          const t = TIER_DISPLAY[tier];
          const isCurrent = currentTier === tier;
          return (
            <div
              key={tier}
              className={`rounded-2xl border bg-[var(--color-paper)] p-5 ${
                isCurrent ? "border-2 border-[var(--color-gold)]" : "border-[var(--color-line)]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-display text-lg font-bold text-[var(--color-navy)]">
                    {t.name}
                  </div>
                  <div className="text-xs text-[var(--color-ink-muted)]">{t.tagline}</div>
                </div>
                {isCurrent && (
                  <span className="shrink-0 rounded-full bg-[var(--color-gold)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-navy-deep)]">
                    Current
                  </span>
                )}
              </div>
              <div className="mt-2 font-display text-xl font-bold text-[var(--color-navy)]">
                {t.price_display}
              </div>
              <ul className="mt-3 space-y-1 text-xs text-[var(--color-ink)]">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--color-teal)]" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={!stripeReady || busy === tier || isCurrent}
                onClick={() => startCheckout(tier)}
                className="mt-4 w-full rounded-lg bg-[var(--color-navy)] px-3 py-2 text-sm font-semibold text-[var(--color-cream)] transition hover:bg-[var(--color-navy-deep)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCurrent
                  ? "Active plan"
                  : busy === tier
                    ? "Loading…"
                    : stripeReady
                      ? `Choose ${t.name}`
                      : "Configure Stripe first"}
              </button>
            </div>
          );
        })}
      </div>
      {error && (
        <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
