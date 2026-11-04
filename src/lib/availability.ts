/**
 * Provider availability resolver. Given a date and a provider, returns
 * the bookable [start, end] intervals for that day in UTC, accounting
 * for:
 *   - the provider's weekly recurring availability (in tenant tz)
 *   - any time-off rows that overlap the day
 *   - the tenant's timezone
 *
 * Intervals returned in UTC milliseconds for easy slot generation.
 */

import { tenantCol } from "./tenant";
import type {
  AvailabilityInterval,
  ProviderAvailabilityDoc,
  ProviderTimeOffDoc,
} from "./firestore-types";

export const DEFAULT_INTERVALS: AvailabilityInterval[] = [
  // Mon–Fri 9am–5pm
  { day: 1, start: 9 * 60, end: 17 * 60 },
  { day: 2, start: 9 * 60, end: 17 * 60 },
  { day: 3, start: 9 * 60, end: 17 * 60 },
  { day: 4, start: 9 * 60, end: 17 * 60 },
  { day: 5, start: 9 * 60, end: 17 * 60 },
];

/**
 * Pull a provider's weekly availability. Falls back to DEFAULT_INTERVALS
 * if the provider hasn't customized.
 */
export async function getProviderAvailability(
  tenantId: string,
  providerId: string,
): Promise<AvailabilityInterval[]> {
  const snap = await tenantCol(tenantId, "providers")
    .doc(providerId)
    .collection("availability")
    .doc("weekly")
    .get()
    .catch(() => null);
  if (!snap || !snap.exists) return DEFAULT_INTERVALS;
  const data = snap.data() as ProviderAvailabilityDoc;
  return data.intervals && data.intervals.length > 0 ? data.intervals : DEFAULT_INTERVALS;
}

/**
 * Pull all time-off ranges that overlap [from, to] for a provider.
 */
export async function getProviderTimeOff(
  tenantId: string,
  providerId: string,
  from: Date,
  to: Date,
): Promise<{ starts_at: Date; ends_at: Date; reason: string | null }[]> {
  const snap = await tenantCol(tenantId, "providers")
    .doc(providerId)
    .collection("time_off")
    .where("ends_at", ">=", from)
    .limit(100)
    .get()
    .catch(() => null);
  if (!snap) return [];
  const out: { starts_at: Date; ends_at: Date; reason: string | null }[] = [];
  for (const d of snap.docs) {
    const t = d.data() as ProviderTimeOffDoc;
    const startMs = t.starts_at.toDate().getTime();
    const endMs = t.ends_at.toDate().getTime();
    if (endMs >= from.getTime() && startMs <= to.getTime()) {
      out.push({
        starts_at: t.starts_at.toDate(),
        ends_at: t.ends_at.toDate(),
        reason: t.reason,
      });
    }
  }
  return out;
}

/**
 * Compute bookable [start, end] millisecond ranges for a single day,
 * given a provider's weekly intervals + tenant timezone. Time-off
 * ranges are subtracted by the caller (slot generator).
 */
export function dayBookableRanges(args: {
  date: Date; // any time on the target day, in any tz; we use UTC y/m/d
  intervals: AvailabilityInterval[];
  tenantTimezone: string;
}): Array<{ startMs: number; endMs: number }> {
  // We need to figure out, in the tenant's tz: the date being asked for,
  // its day-of-week, and convert each interval back to a UTC ms range.
  const tz = args.tenantTimezone || "America/Denver";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(args.date);
  const yyyy = Number(parts.find((p) => p.type === "year")?.value);
  const mm = Number(parts.find((p) => p.type === "month")?.value);
  const dd = Number(parts.find((p) => p.type === "day")?.value);
  const weekdayShort = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = dayMap[weekdayShort] ?? 1;

  const todays = args.intervals.filter((i) => i.day === dow);
  if (todays.length === 0) return [];

  // For each interval, compute the UTC ms by interpreting (yyyy-mm-dd
  // start-min) in the tenant's tz.
  const out: Array<{ startMs: number; endMs: number }> = [];
  for (const iv of todays) {
    const startMs = wallTimeToUtcMs(yyyy, mm, dd, iv.start, tz);
    const endMs = wallTimeToUtcMs(yyyy, mm, dd, iv.end, tz);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      out.push({ startMs, endMs });
    }
  }
  return out;
}

/**
 * Convert (y, m, d, minute-of-day) interpreted in tz → UTC ms.
 *
 * Strategy: build a "guess" UTC time that would correspond to the
 * given wall time if tz were UTC, then look at what tz says about that
 * guess and adjust.
 */
function wallTimeToUtcMs(
  y: number,
  m: number,
  d: number,
  minute: number,
  tz: string,
): number {
  // Build candidate UTC ms as if the wall time were UTC
  const guess = Date.UTC(y, m - 1, d, Math.floor(minute / 60), minute % 60);
  // What does the tz say the wall time was at that UTC ms?
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(guess));
  const seenY = Number(parts.find((p) => p.type === "year")?.value);
  const seenM = Number(parts.find((p) => p.type === "month")?.value);
  const seenD = Number(parts.find((p) => p.type === "day")?.value);
  const seenH = Number(parts.find((p) => p.type === "hour")?.value);
  const seenMin = Number(parts.find((p) => p.type === "minute")?.value);
  const seenAsUtc = Date.UTC(seenY, seenM - 1, seenD, seenH, seenMin);
  // The tz-offset of that UTC instant is (guess - seenAsUtc).
  // Subtract that delta from `guess` to align tz wall time with what we want.
  return guess + (guess - seenAsUtc);
}
