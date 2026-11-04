/**
 * GET /api/admin/leads/export
 *
 * Streams a CSV of all leads. Pulls up to 5000 rows. For larger exports,
 * future enhancement: paginate via cursor and stream in chunks.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-server";
import { db, toDate } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import type { LeadDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = [
  "id",
  "created_at",
  "status",
  "interest",
  "source",
  "contact_name",
  "contact_email",
  "contact_phone",
  "contact_role",
  "clinic_name",
  "clinic_type",
  "locations",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "ip",
  "notes",
];

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export async function GET(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const snap = await db()
    .collection("leads")
    .orderBy("created_at", "desc")
    .limit(10000)
    .get();

  const rows: string[] = [HEADERS.join(",")];
  for (const d of snap.docs) {
    const data = d.data() as LeadDoc;
    const createdAt = toDate(data.created_at);
    rows.push(
      [
        csvEscape(d.id),
        csvEscape(createdAt?.toISOString() ?? ""),
        csvEscape(data.status),
        csvEscape(data.interest),
        csvEscape(data.source),
        csvEscape(data.contact?.full_name ?? ""),
        csvEscape(data.contact?.email ?? ""),
        csvEscape(data.contact?.phone ?? ""),
        csvEscape(data.contact?.role ?? ""),
        csvEscape(data.company?.name ?? ""),
        csvEscape(data.company?.type ?? ""),
        csvEscape(data.company?.locations_count ?? ""),
        csvEscape(data.utm_source ?? ""),
        csvEscape(data.utm_medium ?? ""),
        csvEscape(data.utm_campaign ?? ""),
        csvEscape(data.ip ?? ""),
        csvEscape(data.notes ?? ""),
      ].join(","),
    );
  }
  const csv = rows.join("\n");

  // Audit the export — exporting PII is a sensitive action
  try {
    await writeAudit({
      action: "redaction", // closest existing action; later expand enum
      actorEmail: session.email,
      actorUserId: session.firebaseUid,
      targetType: "lead_export",
      after: { row_count: snap.size },
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: req.headers.get("user-agent") || null,
    });
  } catch (err) {
    console.error("[lead-export] audit failed", err);
  }

  const filename = `aesthera-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
