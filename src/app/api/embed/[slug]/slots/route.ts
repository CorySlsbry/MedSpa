/**
 * GET /api/embed/[slug]/slots?service_id=...&location_id=...&from=YYYY-MM-DD&days=14
 *
 * Returns a list of available time slots for the given service + location,
 * starting `from` and spanning `days` (default 14, max 30). Slots are
 * 30-minute aligned, 9:00–18:00 local time, excluding any that overlap
 * an existing appointment for any provider associated with the location.
 *
 * Algorithm (V1):
 *   - Default open hours: 9am to 6pm, all 7 days
 *   - Step granularity: 30 minutes
 *   - Filter: only slots where service.duration_minutes fits inside the
 *     remaining window before the day's close (18:00).
 *   - Exclude: slots that overlap any active appointment in the location
 *     (for any provider — we'll auto-assign at book time)
 *   - Exclude: slots in the past (using server time + a 1h lead-time buffer)
 *
 * This is a deliberately simple V1. V2 adds per-provider availability,
 * custom open hours, blackout dates, buffer times.
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getTenant, tenantCol } from "@/lib/tenant";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  dayBookableRanges,
  getProviderAvailability,
  getProviderTimeOff,
} from "@/lib/availability";
import type {
  AppointmentDoc,
  ProviderDoc,
  ServiceDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE = { capacity: 120, windowMs: 60 * 60 * 1000 };
const SLOT_GRAIN_MINUTES = 30;
const LEAD_TIME_MS = 60 * 60 * 1000;

export async function GET(
  req: Request,
  rctx: { params: Promise<{ slug: string }> },
) {
  const ip = getIp(req);
  if (ip) {
    const rl = checkRateLimit(`embed-slots:${ip}`, RATE);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }
  }

  const { slug } = await rctx.params;
  const url = new URL(req.url);
  const serviceId = url.searchParams.get("service_id") || "";
  const locationId = url.searchParams.get("location_id") || "";
  const fromStr = url.searchParams.get("from") || todayIso();
  const days = clamp(parseInt(url.searchParams.get("days") || "14", 10), 1, 30);

  if (!serviceId || !locationId) {
    return NextResponse.json(
      { error: "service_id and location_id are required." },
      { status: 400 },
    );
  }

  const tenant = await getTenant(slug);
  if (!tenant || tenant.subscription_status === "cancelled") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const svcSnap = await tenantCol(slug, "services").doc(serviceId).get();
  if (!svcSnap.exists) {
    return NextResponse.json({ error: "Service not found." }, { status: 404 });
  }
  const svc = svcSnap.data() as ServiceDoc;
  if (!svc.is_active) {
    return NextResponse.json({ error: "Service is unavailable." }, { status: 410 });
  }

  // Window: from midnight at `fromStr` for `days` days (in tenant timezone — V1 just uses server local)
  const startDay = new Date(fromStr);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(startDay);
  endDay.setDate(endDay.getDate() + days);

  // Pull active providers attached to this location (or all active if none
  // are tied). For per-provider availability, we need to know whose
  // schedule we're projecting onto.
  const provSnap = await tenantCol(slug, "providers")
    .where("is_active", "==", true)
    .limit(50)
    .get()
    .catch(() => null);
  const providers = provSnap
    ? provSnap.docs
        .map((d) => ({ id: d.id, data: d.data() as ProviderDoc }))
        .filter((p) =>
          // Honor default_location_id if set; allow null defaults to
          // float across all locations.
          !p.data.default_location_id || p.data.default_location_id === locationId,
        )
    : [];

  if (providers.length === 0) {
    return new NextResponse(
      JSON.stringify({
        ok: true,
        service: { id: svcSnap.id, name: svc.name, duration_minutes: svc.duration_minutes },
        slots: [],
      }),
      { status: 200, headers: corsHeaders() },
    );
  }

  // Pull appointments at this location in the window
  const apptSnap = await tenantCol(slug, "appointments")
    .where("location_id", "==", locationId)
    .where("starts_at", ">=", Timestamp.fromDate(startDay))
    .where("starts_at", "<", Timestamp.fromDate(endDay))
    .get()
    .catch(() => null);

  // Per-provider conflicts so we can find a slot that fits SOMEONE
  const conflictsByProvider = new Map<string, { start: number; end: number }[]>();
  if (apptSnap) {
    for (const d of apptSnap.docs) {
      const data = d.data() as AppointmentDoc;
      if (data.status === "cancelled" || data.status === "no_show") continue;
      const s = data.starts_at.toDate().getTime();
      const e = data.ends_at.toDate().getTime();
      const list = conflictsByProvider.get(data.provider_id) ?? [];
      list.push({ start: s, end: e });
      conflictsByProvider.set(data.provider_id, list);
    }
  }

  // Pull each provider's weekly availability + time-off in parallel
  const provData = await Promise.all(
    providers.map(async (p) => {
      const [intervals, timeOff] = await Promise.all([
        getProviderAvailability(slug, p.id),
        getProviderTimeOff(slug, p.id, startDay, endDay),
      ]);
      return { id: p.id, intervals, timeOff };
    }),
  );

  // Build a set of bookable {startMs} candidates. For each day in the
  // window: union of all providers' bookable ranges minus overlaps.
  const grain = SLOT_GRAIN_MINUTES * 60_000;
  const dur = svc.duration_minutes * 60_000;
  const minStart = Date.now() + LEAD_TIME_MS;
  const candidates = new Set<number>();
  for (let day = 0; day < days; day++) {
    const dayDate = new Date(startDay);
    dayDate.setDate(dayDate.getDate() + day);

    for (const prov of provData) {
      const ranges = dayBookableRanges({
        date: dayDate,
        intervals: prov.intervals,
        tenantTimezone: tenant.timezone || "America/Denver",
      });
      const conflicts = conflictsByProvider.get(prov.id) ?? [];
      const offRanges = prov.timeOff;
      for (const r of ranges) {
        for (let t = r.startMs; t + dur <= r.endMs; t += grain) {
          if (t < minStart) continue;
          const slotEnd = t + dur;
          // Check this provider's conflicts
          const conflict = conflicts.some((c) => c.start < slotEnd && c.end > t);
          if (conflict) continue;
          // Check time-off
          const offConflict = offRanges.some(
            (o) => o.starts_at.getTime() < slotEnd && o.ends_at.getTime() > t,
          );
          if (offConflict) continue;
          candidates.add(t);
        }
      }
    }
  }

  const slots = Array.from(candidates)
    .sort((a, b) => a - b)
    .map((t) => {
      const d = new Date(t);
      return {
        iso: d.toISOString(),
        label: d.toLocaleString(undefined, {
          timeZone: tenant.timezone || undefined,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }),
      };
    });

  return new NextResponse(
    JSON.stringify({ ok: true, service: { id: svcSnap.id, name: svc.name, duration_minutes: svc.duration_minutes }, slots }),
    {
      status: 200,
      headers: corsHeaders(),
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=10",
  };
}

function todayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
