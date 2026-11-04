"use client";

import { useEffect, useState } from "react";

type Usage = {
  tier: string;
  limits: {
    max_locations: number | null;
    max_providers: number | null;
    max_active_clients: number | null;
    max_ai_soap_drafts_per_month: number | null;
    max_ai_marketing_emails_per_month: number | null;
    max_ai_concierge_turns_per_month: number | null;
    max_persistent_campaigns: number | null;
    max_marketing_channels: number | null;
    reports_range_days: number;
  };
  resources: {
    locations: number;
    providers: number;
    clients: number;
    campaigns: number;
    marketing_channels: number;
  };
  usage_this_month: {
    period: string;
    ai_soap_drafts: number;
    ai_marketing_emails: number;
    ai_concierge_turns: number;
    sms_sent: number;
  };
  features: {
    photos_before_after: boolean;
    digital_consents: boolean;
    inventory: boolean;
    memberships: boolean;
    api_access: "none" | "read" | "full";
    sso: boolean;
    stripe_connect: boolean;
  };
};

export default function UsageDashboard() {
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/owner/billing/usage");
        const body = await res.json();
        if (!alive) return;
        if (!res.ok) setError(body?.error || "Could not load usage.");
        else setData(body);
      } catch {
        if (alive) setError("Network error.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] px-6 py-12 text-center text-sm text-[var(--color-ink-muted)]">
        Loading usage…
      </div>
    );
  }

  const resourceRows = [
    { label: "Locations", current: data.resources.locations, cap: data.limits.max_locations },
    { label: "Providers", current: data.resources.providers, cap: data.limits.max_providers },
    { label: "Clients", current: data.resources.clients, cap: data.limits.max_active_clients },
    { label: "Persistent campaigns", current: data.resources.campaigns, cap: data.limits.max_persistent_campaigns },
    { label: "Connected social channels", current: data.resources.marketing_channels, cap: data.limits.max_marketing_channels },
  ];
  const usageRows = [
    {
      label: "AI SOAP drafts",
      current: data.usage_this_month.ai_soap_drafts,
      cap: data.limits.max_ai_soap_drafts_per_month,
    },
    {
      label: "AI marketing emails",
      current: data.usage_this_month.ai_marketing_emails,
      cap: data.limits.max_ai_marketing_emails_per_month,
    },
    {
      label: "AI concierge turns",
      current: data.usage_this_month.ai_concierge_turns,
      cap: data.limits.max_ai_concierge_turns_per_month,
    },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
            Plan usage
          </h2>
          <span className="text-xs text-[var(--color-ink-muted)]">
            This month — {data.usage_this_month.period}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          Resource caps are checked at create time. AI usage rolls over on the
          1st of each calendar month (UTC).
        </p>

        <div className="mt-4">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Resources
          </h3>
          <div className="mt-2 space-y-2">
            {resourceRows.map((r) => (
              <UsageBar key={r.label} label={r.label} current={r.current} cap={r.cap} />
            ))}
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            AI usage this month
          </h3>
          <div className="mt-2 space-y-2">
            {usageRows.map((r) => (
              <UsageBar key={r.label} label={r.label} current={r.current} cap={r.cap} />
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
          Features
        </h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <FeatureRow label="Photo + before/after" enabled={data.features.photos_before_after} />
          <FeatureRow label="Digital consent forms" enabled={data.features.digital_consents} />
          <FeatureRow label="Inventory tracking" enabled={data.features.inventory} />
          <FeatureRow label="Memberships" enabled={data.features.memberships} />
          <FeatureRow label="Stripe Connect" enabled={data.features.stripe_connect} />
          <FeatureRow label="SSO" enabled={data.features.sso} />
          <FeatureRow
            label={`API access (${data.features.api_access})`}
            enabled={data.features.api_access !== "none"}
          />
          <FeatureRow
            label={`Reports range: ${data.limits.reports_range_days >= 36500 ? "unlimited" : `${data.limits.reports_range_days}d`}`}
            enabled
          />
        </div>
      </section>
    </div>
  );
}

function UsageBar({
  label,
  current,
  cap,
}: {
  label: string;
  current: number;
  cap: number | null;
}) {
  const unlimited = cap === null;
  const pct = unlimited ? 0 : Math.min(100, Math.round((current / Math.max(1, cap)) * 100));
  const color =
    unlimited
      ? "bg-[var(--color-teal)]"
      : pct >= 100
        ? "bg-rose-600"
        : pct >= 80
          ? "bg-amber-500"
          : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--color-ink-soft)]">{label}</span>
        <span className="font-mono text-[var(--color-ink-muted)]">
          {current.toLocaleString()}
          {unlimited ? " · unlimited" : ` / ${cap.toLocaleString()}`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-cream-deep)]">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: unlimited ? "8%" : `${pct}%` }}
        />
      </div>
    </div>
  );
}

function FeatureRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
          enabled ? "bg-emerald-600" : "bg-gray-300"
        }`}
      >
        {enabled ? "✓" : "—"}
      </span>
      <span className={enabled ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)] line-through"}>
        {label}
      </span>
    </div>
  );
}
