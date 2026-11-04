/**
 * /admin/analytics — marketing-site analytics dashboard.
 *
 * Aggregates events from the `analytics_events` Firestore collection
 * (written by /api/analytics/event from the public marketing pages).
 *
 * Shows:
 *   - Time range toggle (24h / 7d / 30d / 90d)
 *   - Headline KPIs: views, unique sessions, signups, conversion rate
 *   - Scroll-depth funnel (25% / 50% / 75% / 100%)
 *   - Top CTA clicks
 *   - Daily trend (sparkline-style bar chart)
 */

import type { Metadata } from "next";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";

export const metadata: Metadata = {
  title: "Admin · Analytics",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type EventDoc = {
  type: string;
  label: string | null;
  path: string;
  session_id: string;
  ref: string | null;
  ip_hash: string | null;
  user_agent: string;
  created_at: Timestamp;
};

const RANGES = {
  "24h": { label: "Last 24h", days: 1, bucketHours: 1 },
  "7d": { label: "Last 7 days", days: 7, bucketHours: 24 },
  "30d": { label: "Last 30 days", days: 30, bucketHours: 24 },
  "90d": { label: "Last 90 days", days: 90, bucketHours: 24 * 7 },
} as const;
type RangeKey = keyof typeof RANGES;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const range: RangeKey = (sp.range as RangeKey) in RANGES ? (sp.range as RangeKey) : "7d";
  const cfg = RANGES[range];

  const since = Timestamp.fromMillis(Date.now() - cfg.days * 24 * 60 * 60 * 1000);

  const snap = await db()
    .collection("analytics_events")
    .where("created_at", ">=", since)
    .orderBy("created_at", "desc")
    .limit(10000)
    .get()
    .catch(() => null);

  const events = (snap?.docs ?? []).map((d) => d.data() as EventDoc);

  // Aggregations
  const byType = new Map<string, number>();
  const sessions = new Set<string>();
  const ctaCounts = new Map<string, number>();
  const dailyBuckets = new Map<string, { views: number; signups: number }>();

  for (const e of events) {
    byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    sessions.add(e.session_id);

    if (e.type === "click" && e.label) {
      ctaCounts.set(e.label, (ctaCounts.get(e.label) ?? 0) + 1);
    }

    const ts = e.created_at?.toMillis?.() ?? 0;
    const bucketMs = cfg.bucketHours * 60 * 60 * 1000;
    const bucketStart = Math.floor(ts / bucketMs) * bucketMs;
    const bucketKey = new Date(bucketStart).toISOString();
    if (!dailyBuckets.has(bucketKey)) dailyBuckets.set(bucketKey, { views: 0, signups: 0 });
    const b = dailyBuckets.get(bucketKey)!;
    if (e.type === "view") b.views++;
    if (e.type === "signup") b.signups++;
  }

  const views = byType.get("view") ?? 0;
  const signups = byType.get("signup") ?? 0;
  const uniqueSessions = sessions.size;
  const convRate = uniqueSessions > 0 ? (signups / uniqueSessions) * 100 : 0;

  const scrollFunnel = [
    { pct: "25%", count: byType.get("scroll_25") ?? 0 },
    { pct: "50%", count: byType.get("scroll_50") ?? 0 },
    { pct: "75%", count: byType.get("scroll_75") ?? 0 },
    { pct: "100%", count: byType.get("scroll_100") ?? 0 },
  ];
  const scrollMax = Math.max(views, scrollFunnel[0].count, 1);

  const topCtas = Array.from(ctaCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const trend = Array.from(dailyBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ date: k, ...v }));
  const trendMax = Math.max(...trend.map((t) => t.views), 1);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            Marketing analytics
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Aesthera.io traffic, scroll depth, CTA clicks, and signup conversions.
            Anonymous, session-keyed.
          </p>
        </div>
        <div className="flex gap-1">
          {(Object.keys(RANGES) as RangeKey[]).map((k) => (
            <a
              key={k}
              href={`?range=${k}`}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                k === range
                  ? "border-[var(--color-navy)] bg-[var(--color-navy)] text-[var(--color-cream)]"
                  : "border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
              }`}
            >
              {RANGES[k].label}
            </a>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Page views" value={views.toLocaleString()} sub="all marketing routes" />
        <KpiCard label="Unique sessions" value={uniqueSessions.toLocaleString()} sub="anonymous, session-keyed" />
        <KpiCard label="Signups" value={signups.toLocaleString()} sub="form submissions" />
        <KpiCard
          label="Conv. rate"
          value={`${convRate.toFixed(1)}%`}
          sub="signups / unique sessions"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Scroll funnel */}
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Scroll depth funnel
          </h2>
          <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
            Of {views.toLocaleString()} page views, how far visitors scrolled.
          </p>
          <div className="mt-4 space-y-3">
            {scrollFunnel.map((s) => {
              const pct = views > 0 ? Math.round((s.count / views) * 100) : 0;
              const barPct = scrollMax > 0 ? (s.count / scrollMax) * 100 : 0;
              return (
                <div key={s.pct}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-[var(--color-navy)]">{s.pct}</span>
                    <span className="text-[var(--color-ink-muted)] tabular-nums">
                      {s.count.toLocaleString()} <span className="text-[10px]">({pct}%)</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-cream-deep)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--color-teal)] to-[var(--color-gold)]"
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Top CTAs */}
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Top CTA clicks
          </h2>
          <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
            Elements with <code>data-cta</code> attribute. Add the attribute to any new
            button you want tracked.
          </p>
          {topCtas.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-ink-muted)]">
              No CTA clicks yet. Add <code>data-cta=&quot;label&quot;</code> to your buttons to track them.
            </p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                <tr>
                  <th className="pb-2">CTA</th>
                  <th className="pb-2 text-right">Clicks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {topCtas.map(([label, count]) => (
                  <tr key={label}>
                    <td className="py-2 text-xs text-[var(--color-navy)]">{label}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--color-ink-soft)]">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Trend */}
      <section className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Trend
        </h2>
        <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
          {cfg.bucketHours === 1 ? "Hourly" : cfg.bucketHours === 24 ? "Daily" : "Weekly"} views and signups over the {cfg.label.toLowerCase()}.
        </p>
        {trend.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">No traffic in this window yet.</p>
        ) : (
          <div className="mt-4">
            <div className="grid items-end gap-1" style={{ gridTemplateColumns: `repeat(${trend.length}, minmax(0,1fr))`, height: 120 }}>
              {trend.map((t) => (
                <div key={t.date} className="flex flex-col items-center justify-end" title={`${t.date}: ${t.views} views, ${t.signups} signups`}>
                  <div
                    className="w-full rounded-t bg-[var(--color-teal)]"
                    style={{ height: `${(t.views / trendMax) * 100}%` }}
                  />
                  {t.signups > 0 && (
                    <div
                      className="w-full bg-[var(--color-gold)]"
                      style={{ height: `${Math.max(2, (t.signups / trendMax) * 100)}%` }}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-[var(--color-ink-muted)]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[var(--color-teal)]" />
                Views
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[var(--color-gold)]" />
                Signups
              </span>
            </div>
          </div>
        )}
      </section>

      <p className="mt-6 text-[11px] text-[var(--color-ink-muted)]">
        Data refreshed on every page load. To track a button, add <code>data-cta=&quot;Hero · Request demo&quot;</code> (or any label) to the element.
      </p>
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-ink-muted)]">
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-bold text-[var(--color-navy)]">{value}</div>
      <div className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{sub}</div>
    </div>
  );
}
