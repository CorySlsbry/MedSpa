/**
 * GET /api/calendar/[token].ics
 *
 * Public, token-secured iCalendar feed for a provider's schedule.
 * The token is a per-provider random unguessable string. Distribute
 * the URL to the provider; they paste it into Google Calendar
 * "Subscribe from URL" or Apple Calendar "New Calendar Subscription".
 *
 * Returns text/calendar with RFC 5545 events for upcoming + recent
 * appointments (60-day window).
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";
import type {
  AppointmentDoc,
  ClientDoc,
  LocationDoc,
  ProviderDoc,
  TenantDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export async function GET(
  _req: Request,
  rctx: { params: Promise<{ token: string }> },
) {
  const { token: rawToken } = await rctx.params;
  // Strip ".ics" if present (so /calendar/abc123.ics works as well as /calendar/abc123)
  const token = rawToken.replace(/\.ics$/i, "");
  if (!token || token.length < 16) {
    return new NextResponse("invalid token", { status: 400 });
  }

  // Find the provider by ics_token (collection-group query so we don't
  // need to know the tenant slug)
  const provQuery = await db()
    .collectionGroup("providers")
    .where("ics_token", "==", token)
    .limit(1)
    .get();
  if (provQuery.empty) {
    return new NextResponse("not found", { status: 404 });
  }
  const provDoc = provQuery.docs[0];
  const provider = provDoc.data() as ProviderDoc;
  const tenantId = provider.tenant_id;

  // Resolve tenant (for timezone + name)
  const tenantSnap = await db().collection("tenants").doc(tenantId).get();
  if (!tenantSnap.exists) {
    return new NextResponse("tenant gone", { status: 404 });
  }
  const tenant = tenantSnap.data() as TenantDoc;

  // 60-day window: 30d back to 30d forward
  const from = new Date(Date.now() - 30 * DAY);
  const to = new Date(Date.now() + 30 * DAY);

  const apptSnap = await db()
    .collection("tenants")
    .doc(tenantId)
    .collection("appointments")
    .where("provider_id", "==", provDoc.id)
    .where("starts_at", ">=", Timestamp.fromDate(from))
    .where("starts_at", "<=", Timestamp.fromDate(to))
    .limit(500)
    .get();

  // Pre-resolve client + location names
  const clientIds = new Set<string>();
  const locationIds = new Set<string>();
  for (const d of apptSnap.docs) {
    const a = d.data() as AppointmentDoc;
    clientIds.add(a.client_id);
    locationIds.add(a.location_id);
  }
  const clientMap = new Map<string, string>();
  const locMap = new Map<string, string>();
  await Promise.all([
    ...[...clientIds].map(async (cid) => {
      const cs = await db()
        .collection("tenants")
        .doc(tenantId)
        .collection("clients")
        .doc(cid)
        .get()
        .catch(() => null);
      if (cs && cs.exists) clientMap.set(cid, (cs.data() as ClientDoc).full_name);
    }),
    ...[...locationIds].map(async (lid) => {
      const ls = await db()
        .collection("tenants")
        .doc(tenantId)
        .collection("locations")
        .doc(lid)
        .get()
        .catch(() => null);
      if (ls && ls.exists) locMap.set(lid, (ls.data() as LocationDoc).name);
    }),
  ]);

  const events = apptSnap.docs.map((d) => {
    const a = d.data() as AppointmentDoc;
    return buildEvent({
      uid: `${d.id}@aesthera`,
      summary:
        a.status === "cancelled"
          ? `[Cancelled] ${a.service}`
          : `${a.service} — ${clientMap.get(a.client_id) ?? "Client"}`,
      description:
        `Service: ${a.service}\n` +
        `Client: ${clientMap.get(a.client_id) ?? a.client_id}\n` +
        `Status: ${a.status}` +
        (a.notes ? `\n\nNotes: ${a.notes}` : ""),
      location: locMap.get(a.location_id) ?? "",
      start: a.starts_at.toDate(),
      end: a.ends_at.toDate(),
      cancelled: a.status === "cancelled",
    });
  });

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aesthera//Provider Calendar//EN",
    `X-WR-CALNAME:${escapeText(tenant.name)} — ${escapeText(provider.full_name)}`,
    `X-WR-TIMEZONE:${tenant.timezone || "America/Denver"}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="aesthera-${provider.full_name.replace(/\W+/g, "-").toLowerCase()}.ics"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

function buildEvent(args: {
  uid: string;
  summary: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  cancelled: boolean;
}): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${args.uid}`,
    `DTSTAMP:${formatDate(new Date())}`,
    `DTSTART:${formatDate(args.start)}`,
    `DTEND:${formatDate(args.end)}`,
    `SUMMARY:${escapeText(args.summary)}`,
    `DESCRIPTION:${escapeText(args.description)}`,
  ];
  if (args.location) lines.push(`LOCATION:${escapeText(args.location)}`);
  if (args.cancelled) lines.push("STATUS:CANCELLED");
  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

function formatDate(d: Date): string {
  // ISO basic (UTC): YYYYMMDDTHHMMSSZ
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(s: string): string {
  // RFC 5545 — escape \, ;, ,, newlines
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
