/**
 * GET /api/owner/reports?range=30d|90d|1y
 *
 * Comprehensive owner-facing analytics. On-demand aggregation against
 * Firestore reads. At low/medium volume this is fine — once we have
 * tenants with 50K+ appointments/year we'll want to pre-aggregate
 * daily snapshots in a Cloud Function.
 *
 * v2 additions:
 *   - retention: monthly cohorts of first-visit clients with retention
 *     percent in each subsequent month (12-month window, ignores `range`).
 *   - forecast: future-booked + expected revenue for next 30/60d, plus
 *     prior-period comparison and growth pct.
 *   - ltv: avg revenue per client, repeat-visit rate, avg visits/client.
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { limitsFor } from "@/lib/tier-limits";
import type {
  AppointmentDoc,
  CampaignRunDoc,
  ClientDoc,
  ServiceDoc,
  ProviderDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  range: z.enum(["30d", "90d", "1y"]).default("30d"),
});

const DAY = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!["tenant_owner", "tenant_manager"].includes(ctx.user.role)) {
    return NextResponse.json({ error: "Reports are owner / manager only." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = Query.safeParse({ range: searchParams.get("range") ?? "30d" });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid range." }, { status: 400 });
  }

  const requestedDays = parsed.data.range === "30d" ? 30 : parsed.data.range === "90d" ? 90 : 365;
  const tierMaxDays = limitsFor(ctx.tenant).reports_range_days;
  const days = Math.min(requestedDays, tierMaxDays);
  const tierCapped = days < requestedDays;
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY);

  // Pull appointments in range — used for bookings + revenue + per-day series
  const apptSnap = await tenantCol(ctx.tenant.id, "appointments")
    .where("starts_at", ">=", Timestamp.fromDate(from))
    .where("starts_at", "<=", Timestamp.fromDate(to))
    .limit(5000)
    .get()
    .catch(() => null);

  const appts: AppointmentDoc[] = apptSnap?.docs.map((d) => d.data() as AppointmentDoc) ?? [];

  // Resolve service prices for revenue (snapshot lookups)
  const serviceMap = new Map<string, ServiceDoc>();
  const svcSnap = await tenantCol(ctx.tenant.id, "services")
    .limit(500)
    .get()
    .catch(() => null);
  if (svcSnap) {
    for (const d of svcSnap.docs) {
      serviceMap.set((d.data() as ServiceDoc).name, d.data() as ServiceDoc);
    }
  }
  const providerMap = new Map<string, ProviderDoc>();
  const provSnap = await tenantCol(ctx.tenant.id, "providers")
    .limit(200)
    .get()
    .catch(() => null);
  if (provSnap) {
    for (const d of provSnap.docs) {
      providerMap.set(d.id, d.data() as ProviderDoc);
    }
  }

  // Compute totals
  let revenueCents = 0;
  let completed = 0;
  let noShow = 0;
  let cancelled = 0;
  for (const a of appts) {
    if (a.status === "completed") {
      completed++;
      const svc = serviceMap.get(a.service);
      if (svc?.price_cents) revenueCents += svc.price_cents;
    } else if (a.status === "no_show") noShow++;
    else if (a.status === "cancelled") cancelled++;
  }
  const completionRate = appts.length > 0 ? completed / appts.length : 0;

  // Clients in range
  let clientsTotal = 0;
  let clientsNew = 0;
  const clientsSnap = await tenantCol(ctx.tenant.id, "clients").limit(2000).get().catch(() => null);
  if (clientsSnap) {
    clientsTotal = clientsSnap.size;
    for (const d of clientsSnap.docs) {
      const c = d.data() as ClientDoc;
      const created = c.created_at as Timestamp | undefined;
      if (created && created.toDate() >= from) clientsNew++;
    }
  }

  // Bookings per day
  const dayMap = new Map<string, { count: number; completed: number }>();
  for (let i = 0; i <= days; i++) {
    const d = new Date(from.getTime() + i * DAY);
    const key = d.toISOString().slice(0, 10);
    dayMap.set(key, { count: 0, completed: 0 });
  }
  for (const a of appts) {
    const ts = (a.starts_at as Timestamp).toDate();
    const key = ts.toISOString().slice(0, 10);
    if (!dayMap.has(key)) dayMap.set(key, { count: 0, completed: 0 });
    const cur = dayMap.get(key)!;
    cur.count++;
    if (a.status === "completed") cur.completed++;
  }
  const bookingsByDay = Array.from(dayMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, count: v.count, completed: v.completed }));

  // Top services
  const svcAgg = new Map<string, { count: number; revenue_cents: number }>();
  for (const a of appts) {
    const svc = serviceMap.get(a.service);
    const cur = svcAgg.get(a.service) ?? { count: 0, revenue_cents: 0 };
    cur.count++;
    if (a.status === "completed" && svc?.price_cents) cur.revenue_cents += svc.price_cents;
    svcAgg.set(a.service, cur);
  }
  const topServices = Array.from(svcAgg.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Top providers
  const provAgg = new Map<string, { count: number; revenue_cents: number }>();
  for (const a of appts) {
    const cur = provAgg.get(a.provider_id) ?? { count: 0, revenue_cents: 0 };
    cur.count++;
    if (a.status === "completed") {
      const svc = serviceMap.get(a.service);
      if (svc?.price_cents) cur.revenue_cents += svc.price_cents;
    }
    provAgg.set(a.provider_id, cur);
  }
  const topProviders = Array.from(provAgg.entries())
    .map(([id, v]) => ({
      id,
      name: providerMap.get(id)?.full_name ?? "Unknown provider",
      ...v,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Marketing engagement
  const runsSnap = await tenantCol(ctx.tenant.id, "campaign_runs")
    .where("created_at", ">=", Timestamp.fromDate(from))
    .limit(2000)
    .get()
    .catch(() => null);
  let runsSent = 0;
  let runsOpened = 0;
  let runsClicked = 0;
  let runsBounced = 0;
  if (runsSnap) {
    for (const d of runsSnap.docs) {
      const r = d.data() as CampaignRunDoc;
      // Status is monotonic — clicked implies opened implies delivered
      // implies sent. Count each cumulatively so open_rate / click_rate
      // are interpretable as "of all sent emails, what % at-least-opened
      // / at-least-clicked." Don't double-count.
      if (r.status === "sent" || r.status === "delivered" || r.status === "opened" || r.status === "clicked") runsSent++;
      if (r.status === "opened" || r.status === "clicked") runsOpened++;
      if (r.status === "clicked") runsClicked++;
      if (r.status === "bounced") runsBounced++;
    }
  }
  const openRate = runsSent > 0 ? runsOpened / runsSent : 0;
  const clickRate = runsSent > 0 ? runsClicked / runsSent : 0;

  // ─── v2: retention cohorts (12 months) ──────────────────────────────────────
  // Pull all completed appointments in the last 12 months. For each client
  // bucket them by first-visit month and compute % who returned in each
  // subsequent month.
  const COHORT_MONTHS = 12;
  const cohortFrom = new Date(to.getTime() - COHORT_MONTHS * 31 * DAY);
  const cohortSnap = await tenantCol(ctx.tenant.id, "appointments")
    .where("status", "==", "completed")
    .where("starts_at", ">=", Timestamp.fromDate(cohortFrom))
    .where("starts_at", "<=", Timestamp.fromDate(to))
    .limit(20000)
    .get()
    .catch(() => null);

  const retention = buildRetentionCohorts(
    cohortSnap?.docs.map((d) => d.data() as AppointmentDoc) ?? [],
    COHORT_MONTHS,
  );

  // ─── v2: forecast (next 60 days) ────────────────────────────────────────────
  const futureCap = new Date(to.getTime() + 60 * DAY);
  const futureSnap = await tenantCol(ctx.tenant.id, "appointments")
    .where("starts_at", ">", Timestamp.fromDate(to))
    .where("starts_at", "<=", Timestamp.fromDate(futureCap))
    .limit(2000)
    .get()
    .catch(() => null);

  let booked30Cents = 0;
  let booked30Count = 0;
  let booked60Cents = 0;
  let booked60Count = 0;
  if (futureSnap) {
    const cap30 = to.getTime() + 30 * DAY;
    // Forecast counts only forward-looking, scheduleable bookings.
    // cancelled — explicitly off the books.
    // completed/no_show — cannot legitimately exist in the future window;
    // exclude defensively in case of clock skew or backfill imports.
    const FORECAST_INCLUDE: AppointmentDoc["status"][] = [
      "scheduled",
      "checked_in",
      "in_progress",
    ];
    for (const d of futureSnap.docs) {
      const a = d.data() as AppointmentDoc;
      if (!FORECAST_INCLUDE.includes(a.status)) continue;
      const svc = serviceMap.get(a.service);
      const price = svc?.price_cents ?? 0;
      const ts = (a.starts_at as Timestamp).toMillis();
      booked60Cents += price;
      booked60Count++;
      if (ts <= cap30) {
        booked30Cents += price;
        booked30Count++;
      }
    }
  }

  // Prior comparable period (same length as `range`)
  const priorTo = from;
  const priorFrom = new Date(priorTo.getTime() - days * DAY);
  const priorSnap = await tenantCol(ctx.tenant.id, "appointments")
    .where("status", "==", "completed")
    .where("starts_at", ">=", Timestamp.fromDate(priorFrom))
    .where("starts_at", "<", Timestamp.fromDate(priorTo))
    .limit(5000)
    .get()
    .catch(() => null);
  let priorRevenueCents = 0;
  if (priorSnap) {
    for (const d of priorSnap.docs) {
      const a = d.data() as AppointmentDoc;
      const svc = serviceMap.get(a.service);
      if (svc?.price_cents) priorRevenueCents += svc.price_cents;
    }
  }
  const growthPct = priorRevenueCents > 0
    ? (revenueCents - priorRevenueCents) / priorRevenueCents
    : revenueCents > 0 ? 1 : 0;

  // Expected = booked × historical completion rate, scaled to revenue dollars
  const expected30Cents = Math.round(booked30Cents * (completionRate || 0.85));
  const expected60Cents = Math.round(booked60Cents * (completionRate || 0.85));

  // ─── v2: LTV ────────────────────────────────────────────────────────────────
  // Across the selected `range`: avg revenue per unique client, repeat rate,
  // avg visits per client.
  const visitsByClient = new Map<string, number>();
  const revenueByClient = new Map<string, number>();
  for (const a of appts) {
    if (a.status !== "completed") continue;
    visitsByClient.set(a.client_id, (visitsByClient.get(a.client_id) ?? 0) + 1);
    const svc = serviceMap.get(a.service);
    if (svc?.price_cents) {
      revenueByClient.set(
        a.client_id,
        (revenueByClient.get(a.client_id) ?? 0) + svc.price_cents,
      );
    }
  }
  const uniqueClients = visitsByClient.size;
  const repeatClients = Array.from(visitsByClient.values()).filter((n) => n >= 2).length;
  const totalVisits = Array.from(visitsByClient.values()).reduce((a, b) => a + b, 0);
  const avgRevenuePerClient = uniqueClients > 0
    ? Math.round(Array.from(revenueByClient.values()).reduce((a, b) => a + b, 0) / uniqueClients)
    : 0;
  const repeatRate = uniqueClients > 0 ? repeatClients / uniqueClients : 0;
  const avgVisitsPerClient = uniqueClients > 0 ? totalVisits / uniqueClients : 0;

  return NextResponse.json({
    ok: true,
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
      label: parsed.data.range,
      days,
      tier_capped: tierCapped,
      tier_max_days: tierMaxDays,
    },
    totals: {
      revenue_cents: revenueCents,
      bookings_total: appts.length,
      bookings_completed: completed,
      bookings_no_show: noShow,
      bookings_cancelled: cancelled,
      clients_total: clientsTotal,
      clients_new: clientsNew,
      completion_rate: completionRate,
    },
    bookings_by_day: bookingsByDay,
    top_services: topServices,
    top_providers: topProviders,
    marketing: {
      runs_sent: runsSent,
      runs_opened: runsOpened,
      runs_clicked: runsClicked,
      runs_bounced: runsBounced,
      open_rate: openRate,
      click_rate: clickRate,
    },
    retention,
    forecast: {
      booked_30d_cents: booked30Cents,
      booked_30d_count: booked30Count,
      booked_60d_cents: booked60Cents,
      booked_60d_count: booked60Count,
      expected_30d_cents: expected30Cents,
      expected_60d_cents: expected60Cents,
      prior_period_revenue_cents: priorRevenueCents,
      growth_pct: growthPct,
    },
    ltv: {
      unique_clients: uniqueClients,
      repeat_clients: repeatClients,
      avg_revenue_per_client_cents: avgRevenuePerClient,
      repeat_rate: repeatRate,
      avg_visits_per_client: avgVisitsPerClient,
    },
  });
}

// Bucket clients by first-visit month, then for each cohort compute
// the percent who returned in each subsequent month (m0…m11).
function buildRetentionCohorts(
  appts: AppointmentDoc[],
  monthsBack: number,
): {
  months: string[];
  cohorts: { cohort: string; size: number; retention: (number | null)[] }[];
} {
  // Sort by date ascending so we can find each client's first visit.
  const sorted = [...appts].sort(
    (a, b) => (a.starts_at as Timestamp).toMillis() - (b.starts_at as Timestamp).toMillis(),
  );

  // First visit per client
  const firstByClient = new Map<string, Date>();
  // Set of "yyyy-mm" months a client visited
  const monthsByClient = new Map<string, Set<string>>();
  for (const a of sorted) {
    const ts = (a.starts_at as Timestamp).toDate();
    if (!firstByClient.has(a.client_id)) firstByClient.set(a.client_id, ts);
    const key = `${ts.getUTCFullYear()}-${String(ts.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!monthsByClient.has(a.client_id)) monthsByClient.set(a.client_id, new Set());
    monthsByClient.get(a.client_id)!.add(key);
  }

  // Build the list of cohort months (oldest → most recent)
  const now = new Date();
  const cohortKeys: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    cohortKeys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  // Bucket clients into cohorts
  const cohortBuckets = new Map<string, string[]>();
  for (const [clientId, firstAt] of firstByClient) {
    const key = `${firstAt.getUTCFullYear()}-${String(firstAt.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!cohortKeys.includes(key)) continue;
    if (!cohortBuckets.has(key)) cohortBuckets.set(key, []);
    cohortBuckets.get(key)!.push(clientId);
  }

  // For each cohort, compute retention[m] = % of clients with a visit in
  // (cohort + m months). m=0 is always 100% by definition.
  const cohorts = cohortKeys.map((cohort) => {
    const clientIds = cohortBuckets.get(cohort) ?? [];
    const size = clientIds.length;
    const cohortIdx = cohortKeys.indexOf(cohort);
    const remainingMonths = cohortKeys.length - cohortIdx;
    const [cy, cm] = cohort.split("-").map(Number);
    const retention: (number | null)[] = [];
    for (let m = 0; m < monthsBack; m++) {
      if (m >= remainingMonths) {
        retention.push(null); // future month, not measurable yet
        continue;
      }
      const targetDate = new Date(Date.UTC(cy, (cm - 1) + m, 1));
      const targetKey = `${targetDate.getUTCFullYear()}-${String(targetDate.getUTCMonth() + 1).padStart(2, "0")}`;
      let count = 0;
      for (const cid of clientIds) {
        if (monthsByClient.get(cid)?.has(targetKey)) count++;
      }
      retention.push(size > 0 ? count / size : 0);
    }
    return { cohort, size, retention };
  });

  return { months: cohortKeys, cohorts };
}
