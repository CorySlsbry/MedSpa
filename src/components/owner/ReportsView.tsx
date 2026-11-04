"use client";

import { useEffect, useState } from "react";

type Range = "30d" | "90d" | "1y";

type Report = {
  range: { from: string; to: string; label: Range; days: number };
  totals: {
    revenue_cents: number;
    bookings_total: number;
    bookings_completed: number;
    bookings_no_show: number;
    bookings_cancelled: number;
    clients_total: number;
    clients_new: number;
    completion_rate: number;
  };
  bookings_by_day: { date: string; count: number; completed: number }[];
  top_services: { name: string; count: number; revenue_cents: number }[];
  top_providers: { id: string; name: string; count: number; revenue_cents: number }[];
  marketing: {
    runs_sent: number;
    runs_opened: number;
    runs_clicked: number;
    runs_bounced: number;
    open_rate: number;
    click_rate: number;
  };
  retention: {
    months: string[];
    cohorts: { cohort: string; size: number; retention: (number | null)[] }[];
  };
  forecast: {
    booked_30d_cents: number;
    booked_30d_count: number;
    booked_60d_cents: number;
    booked_60d_count: number;
    expected_30d_cents: number;
    expected_60d_cents: number;
    prior_period_revenue_cents: number;
    growth_pct: number;
  };
  ltv: {
    unique_clients: number;
    repeat_clients: number;
    avg_revenue_per_client_cents: number;
    repeat_rate: number;
    avg_visits_per_client: number;
  };
};

export default function ReportsView() {
  const [range, setRange] = useState<Range>("30d");
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/owner/reports?range=${range}`);
        const body = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setError(body?.error || "Could not load reports.");
          setData(null);
        } else {
          setData(body);
        }
      } catch {
        if (alive) setError("Network error.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range]);

  return (
    <div>
      {/* Range picker */}
      <div className="flex items-center gap-2">
        {(["30d", "90d", "1y"] as Range[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              range === r
                ? "bg-[var(--color-navy)] text-[var(--color-cream)]"
                : "border border-[var(--color-line)] bg-[var(--color-paper)] text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
            }`}
          >
            {r === "30d" ? "Last 30 days" : r === "90d" ? "Last 90 days" : "Last year"}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--color-line)] px-6 py-12 text-center text-sm text-[var(--color-ink-muted)]">
          Loading…
        </div>
      )}

      {data && (
        <>
          {/* Headline KPIs */}
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Revenue"
              value={`$${(data.totals.revenue_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
              sub={`${data.totals.bookings_completed} completed visits`}
              accent="gold"
            />
            <Kpi
              label="Bookings"
              value={data.totals.bookings_total.toLocaleString()}
              sub={`${(data.totals.completion_rate * 100).toFixed(0)}% completed · ${data.totals.bookings_no_show} no-show`}
            />
            <Kpi
              label="New clients"
              value={data.totals.clients_new.toLocaleString()}
              sub={`${data.totals.clients_total.toLocaleString()} total in book`}
            />
            <Kpi
              label="Email open rate"
              value={`${(data.marketing.open_rate * 100).toFixed(0)}%`}
              sub={`${data.marketing.runs_sent} sent · ${data.marketing.runs_opened} opened${data.marketing.runs_clicked > 0 ? ` · ${data.marketing.runs_clicked} clicked` : ""}`}
            />
          </div>

          {/* Bookings per day */}
          <Section title="Bookings per day" subtitle="Filled bars are completed; outline is total scheduled">
            <BarChart data={data.bookings_by_day} />
          </Section>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Section title="Top services" subtitle="By booking volume in range">
              <RankList
                rows={data.top_services.map((s) => ({
                  key: s.name,
                  primary: s.name,
                  count: s.count,
                  secondary:
                    s.revenue_cents > 0
                      ? `$${(s.revenue_cents / 100).toLocaleString()} revenue`
                      : "—",
                }))}
              />
            </Section>
            <Section title="Top providers" subtitle="By bookings handled">
              <RankList
                rows={data.top_providers.map((p) => ({
                  key: p.id,
                  primary: p.name,
                  count: p.count,
                  secondary:
                    p.revenue_cents > 0
                      ? `$${(p.revenue_cents / 100).toLocaleString()} revenue`
                      : "—",
                }))}
              />
            </Section>
          </div>

          {/* Forecast + LTV row */}
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <ForecastCard forecast={data.forecast} priorDays={data.range.days} />
            <LtvCard ltv={data.ltv} />
            <GrowthCard
              currentRevenue={data.totals.revenue_cents}
              priorRevenue={data.forecast.prior_period_revenue_cents}
              growthPct={data.forecast.growth_pct}
              days={data.range.days}
            />
          </div>

          {/* Retention cohort heatmap */}
          <Section
            title="Client retention cohorts"
            subtitle="Of clients who first visited in row month, % returning each subsequent month"
          >
            <CohortHeatmap retention={data.retention} />
          </Section>

          <p className="mt-6 text-[11px] text-[var(--color-ink-muted)]">
            Range: {new Date(data.range.from).toLocaleDateString()} →{" "}
            {new Date(data.range.to).toLocaleDateString()} ({data.range.days} days). Retention covers the last 12 months. All data is read live from
            Firestore — no aggregation cache yet.
          </p>
        </>
      )}
    </div>
  );
}

function ForecastCard({
  forecast,
  priorDays,
}: {
  forecast: Report["forecast"];
  priorDays: number;
}) {
  const fmt = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        Revenue forecast
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div className="font-display text-3xl font-bold text-[var(--color-navy)]">
          {fmt(forecast.expected_30d_cents)}
        </div>
        <div className="text-xs text-[var(--color-ink-muted)]">expected · next 30d</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">Booked 30d</div>
          <div className="mt-0.5 font-bold text-[var(--color-navy)]">{fmt(forecast.booked_30d_cents)}</div>
          <div className="text-[10px] text-[var(--color-ink-muted)]">{forecast.booked_30d_count} appts</div>
        </div>
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">Booked 60d</div>
          <div className="mt-0.5 font-bold text-[var(--color-navy)]">{fmt(forecast.booked_60d_cents)}</div>
          <div className="text-[10px] text-[var(--color-ink-muted)]">{forecast.booked_60d_count} appts</div>
        </div>
      </div>
      <div className="mt-3 text-[10px] text-[var(--color-ink-muted)]">
        Expected = booked × historical completion rate. Prior {priorDays}-day revenue: {fmt(forecast.prior_period_revenue_cents)}.
      </div>
    </div>
  );
}

function LtvCard({ ltv }: { ltv: Report["ltv"] }) {
  const fmt = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        Avg revenue / client
      </div>
      <div className="mt-2 font-display text-3xl font-bold text-[var(--color-navy)]">
        {fmt(ltv.avg_revenue_per_client_cents)}
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-[var(--color-ink-muted)]">Unique clients</span>
          <span className="font-semibold text-[var(--color-ink)]">{ltv.unique_clients.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--color-ink-muted)]">Repeat clients (2+ visits)</span>
          <span className="font-semibold text-[var(--color-ink)]">
            {ltv.repeat_clients.toLocaleString()} · {(ltv.repeat_rate * 100).toFixed(0)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--color-ink-muted)]">Avg visits / client</span>
          <span className="font-semibold text-[var(--color-ink)]">{ltv.avg_visits_per_client.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

function GrowthCard({
  currentRevenue,
  priorRevenue,
  growthPct,
  days,
}: {
  currentRevenue: number;
  priorRevenue: number;
  growthPct: number;
  days: number;
}) {
  const fmt = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const positive = growthPct >= 0;
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        Period over period
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <div
          className={`font-display text-3xl font-bold ${positive ? "text-emerald-700" : "text-rose-700"}`}
        >
          {positive ? "+" : ""}
          {(growthPct * 100).toFixed(0)}%
        </div>
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-[var(--color-ink-muted)]">This {days}d</span>
          <span className="font-semibold text-[var(--color-ink)]">{fmt(currentRevenue)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--color-ink-muted)]">Prior {days}d</span>
          <span className="font-semibold text-[var(--color-ink)]">{fmt(priorRevenue)}</span>
        </div>
      </div>
    </div>
  );
}

function CohortHeatmap({ retention }: { retention: Report["retention"] }) {
  if (retention.cohorts.length === 0 || retention.cohorts.every((c) => c.size === 0)) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-cream)] px-4 py-6 text-center text-xs text-[var(--color-ink-muted)]">
        Not enough completed visits across the past 12 months to build a cohort view yet.
      </div>
    );
  }
  // Show a max of 12 columns
  const cols = retention.months.length;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
            <th className="px-2 py-2 text-left font-semibold">Cohort</th>
            <th className="px-2 py-2 text-right font-semibold">Size</th>
            {Array.from({ length: cols }).map((_, m) => (
              <th key={m} className="px-2 py-2 text-center font-semibold">
                M{m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {retention.cohorts.map((c) => (
            <tr key={c.cohort} className="border-t border-[var(--color-line)]">
              <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-[var(--color-ink)]">
                {formatCohortMonth(c.cohort)}
              </td>
              <td className="px-2 py-1.5 text-right text-[var(--color-ink-soft)]">
                {c.size}
              </td>
              {c.retention.map((v, m) => (
                <td key={m} className="px-1 py-1 text-center">
                  {v === null ? (
                    <div className="h-6 w-12 rounded border border-dashed border-[var(--color-line)] bg-transparent" />
                  ) : (
                    <div
                      className="mx-auto flex h-6 w-12 items-center justify-center rounded text-[10px] font-bold"
                      style={{
                        background: `rgba(46, 105, 102, ${0.1 + v * 0.85})`,
                        color: v > 0.5 ? "#fff" : "var(--color-ink)",
                      }}
                      title={`${(v * 100).toFixed(0)}% retained`}
                    >
                      {(v * 100).toFixed(0)}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 text-[10px] text-[var(--color-ink-muted)]">
        Numbers are percent of cohort returning that many months later. Dashed cells are future months.
      </div>
    </div>
  );
}

function formatCohortMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "gold";
}) {
  return (
    <div
      className={`rounded-2xl border bg-[var(--color-paper)] p-5 shadow-sm ${
        accent === "gold"
          ? "border-[var(--color-gold)]"
          : "border-[var(--color-line)]"
      }`}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-bold text-[var(--color-navy)]">
        {value}
      </div>
      <div className="mt-1 text-xs text-[var(--color-ink-muted)]">{sub}</div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">{title}</h2>
        {subtitle && <span className="text-xs text-[var(--color-ink-muted)]">{subtitle}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function BarChart({ data }: { data: { date: string; count: number; completed: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  // Show every Nth label so it's not crowded
  const labelEvery = data.length > 60 ? 14 : data.length > 30 ? 7 : 5;
  return (
    <div>
      <div className="flex h-32 items-end gap-[2px]">
        {data.map((d) => {
          const h = (d.count / max) * 100;
          const ch = (d.completed / max) * 100;
          return (
            <div
              key={d.date}
              title={`${d.date}: ${d.count} booked · ${d.completed} completed`}
              className="relative flex-1 rounded-t-sm border border-[var(--color-gold)] bg-transparent"
              style={{ height: `${Math.max(h, 1)}%` }}
            >
              <div
                className="absolute inset-x-0 bottom-0 rounded-t-sm bg-[var(--color-gold)]"
                style={{ height: `${(ch / Math.max(h, 1)) * 100}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-[var(--color-ink-muted)]">
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <span key={d.date}>{new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function RankList({ rows }: { rows: { key: string; primary: string; count: number; secondary: string }[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-cream)] px-4 py-6 text-center text-xs text-[var(--color-ink-muted)]">
        No data in this range.
      </div>
    );
  }
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--color-ink)]">{r.primary}</div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-cream-deep)]">
              <div
                className="h-full rounded-full bg-[var(--color-teal)]"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
          </div>
          <div className="text-right text-xs">
            <div className="font-bold text-[var(--color-navy)]">{r.count}</div>
            <div className="text-[10px] text-[var(--color-ink-muted)]">{r.secondary}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
