/**
 * POST /api/owner/clients/import  — CSV bulk import.
 *
 * Accepts a CSV body with columns: email, full_name, phone (optional),
 * preferred_name (optional), date_of_birth (optional, ISO yyyy-mm-dd),
 * tags (optional, semicolon-separated).
 *
 * Header row is required. Quoted fields (RFC 4180) supported. Email
 * dedup is enforced per row (against existing clients in the tenant).
 *
 * Returns { created, skipped, errors[] }.
 *
 * Limit: 1000 rows per upload.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import type { ClientDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 1000;

const RowSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  full_name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).optional(),
  preferred_name: z.string().trim().max(80).optional(),
  date_of_birth: z.string().trim().max(20).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
});

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  let body: string;
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      const json = (await req.json()) as { csv?: string };
      body = json.csv || "";
    } else {
      body = await req.text();
    }
  } catch {
    return NextResponse.json({ error: "Could not read request body." }, { status: 400 });
  }
  if (!body.trim()) {
    return NextResponse.json({ error: "Empty CSV." }, { status: 400 });
  }

  let parsed: ParsedRow[];
  try {
    parsed = parseCsv(body);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not parse CSV: ${(err as Error).message}` },
      { status: 400 },
    );
  }
  if (parsed.length === 0) {
    return NextResponse.json({ error: "No data rows found." }, { status: 400 });
  }
  if (parsed.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows (${parsed.length}). Max is ${MAX_ROWS}.` },
      { status: 400 },
    );
  }

  // Pre-load existing emails for dedup
  const existing = new Set<string>();
  try {
    const snap = await tenantCol(ctx.tenant.id, "clients").select("email").get();
    for (const d of snap.docs) {
      const email = (d.data() as { email?: string }).email;
      if (email) existing.add(email.toLowerCase());
    }
  } catch (err) {
    console.error("[clients-import] dedup load", err);
  }

  const errors: { row: number; reason: string }[] = [];
  const valid: { row: number; data: z.infer<typeof RowSchema> }[] = [];
  const seenInBatch = new Set<string>();

  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i];
    const rowNum = r._rowNum;
    const tagsArr = r.tags
      ? r.tags.split(";").map((t) => t.trim()).filter(Boolean)
      : undefined;
    const candidate = {
      email: r.email || "",
      full_name: r.full_name || "",
      phone: r.phone || undefined,
      preferred_name: r.preferred_name || undefined,
      date_of_birth: r.date_of_birth || undefined,
      tags: tagsArr,
    };
    const validation = RowSchema.safeParse(candidate);
    if (!validation.success) {
      errors.push({ row: rowNum, reason: validation.error.issues[0]?.message ?? "invalid" });
      continue;
    }
    const email = validation.data.email;
    if (existing.has(email)) {
      errors.push({ row: rowNum, reason: "already exists" });
      continue;
    }
    if (seenInBatch.has(email)) {
      errors.push({ row: rowNum, reason: "duplicate within file" });
      continue;
    }
    seenInBatch.add(email);
    valid.push({ row: rowNum, data: validation.data });
  }

  // Batch writes (Firestore max 500 ops per batch)
  let created = 0;
  for (let i = 0; i < valid.length; i += 400) {
    const batch = db().batch();
    const slice = valid.slice(i, i + 400);
    for (const v of slice) {
      const ref = tenantCol(ctx.tenant.id, "clients").doc();
      const doc: Omit<ClientDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        email: v.data.email,
        full_name: v.data.full_name,
        phone: v.data.phone || null,
        date_of_birth: v.data.date_of_birth || null,
        preferred_name: v.data.preferred_name || null,
        default_location_id: null,
        email_consent: true,
        sms_consent: false,
        hipaa_consent_signed_at: null,
        tags: v.data.tags || [],
        created_at: now(),
        updated_at: now(),
      };
      batch.create(ref, doc);
    }
    try {
      await batch.commit();
      created += slice.length;
    } catch (err) {
      console.error("[clients-import] batch failed", err);
      // Mark this slice as failed
      for (const v of slice) {
        errors.push({ row: v.row, reason: "write failed" });
      }
    }
  }

  // Audit the bulk action
  try {
    await writeAudit({
      action: "admin.user_create",
      actorEmail: ctx.user.email,
      actorUserId: ctx.user.firebaseUid,
      targetType: "clients.bulk_import",
      after: { created, skipped: errors.length, total: parsed.length },
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: req.headers.get("user-agent") || null,
    });
  } catch (err) {
    console.error("[clients-import] audit", err);
  }

  return NextResponse.json({
    ok: true,
    created,
    skipped: errors.length,
    total: parsed.length,
    errors: errors.slice(0, 50), // cap to avoid huge responses
  });
}

// ── CSV parser (RFC 4180-ish) ──────────────────────────────────────────────

type ParsedRow = {
  _rowNum: number;
  email?: string;
  full_name?: string;
  phone?: string;
  preferred_name?: string;
  date_of_birth?: string;
  tags?: string;
};

function parseCsv(text: string): ParsedRow[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const aliases: Record<string, keyof ParsedRow> = {
    email: "email",
    "e-mail": "email",
    name: "full_name",
    full_name: "full_name",
    fullname: "full_name",
    phone: "phone",
    mobile: "phone",
    preferred_name: "preferred_name",
    nickname: "preferred_name",
    dob: "date_of_birth",
    date_of_birth: "date_of_birth",
    birthday: "date_of_birth",
    tags: "tags",
  };
  const out: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    if (cols.length === 0 || cols.every((c) => !c.trim())) continue;
    const obj: ParsedRow = { _rowNum: i + 1 };
    for (let c = 0; c < header.length; c++) {
      const key = aliases[header[c]];
      if (key && key !== "_rowNum" && cols[c] !== undefined) {
        (obj as Record<string, unknown>)[key] = cols[c].trim();
      }
    }
    out.push(obj);
  }
  return out;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let buf = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          buf += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      cur.push(buf);
      buf = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      cur.push(buf);
      rows.push(cur);
      cur = [];
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  // flush
  if (buf.length > 0 || cur.length > 0) {
    cur.push(buf);
    rows.push(cur);
  }
  return rows;
}
