/**
 * POST /api/integrations/jarvis/leads/match
 *
 * Cheap lookup-only endpoint for Jarvis to check whether a candidate
 * matches an existing lead BEFORE spending an Apollo credit on
 * email/phone reveal. No write, no enrollment, no workflow side effects.
 *
 * Lookup priority (first hit wins):
 *   1. email_normalized
 *   2. apollo_person_id
 *   3. phone_digits
 *   4. name_company_key
 *   5. linkedin_normalized
 *
 * Auth: Bearer token via JARVIS_API_KEY env var. Same secret Jarvis
 * uses for the POST ingest endpoint (mounted as JP_AESTHERA_INGEST_TOKEN
 * in Jarvis Secret Manager).
 *
 * Rate limit: 120 req/min/IP. Each lookup is a single indexed equality
 * query with limit(1) — Firestore makes this trivially sub-100ms.
 *
 * Performance: Firestore single-field equality is auto-indexed; every
 * lookup hits an index by definition. No EXPLAIN equivalent — that's
 * Postgres terminology that doesn't apply here.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeIntegration } from "@/lib/integrations-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { computeQualifiers, lookupExistingLeadByQualifiers } from "@/lib/lead-dedup";
import { loadCurrentWorkflow } from "@/lib/lead-current-workflow";
import { toDate } from "@/lib/firestore";
import type { LeadDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE = { capacity: 120, windowMs: 60 * 1000 };

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(320).optional().nullable(),
  first_name: z.string().trim().max(80).optional().nullable(),
  last_name: z.string().trim().max(80).optional().nullable(),
  full_name: z.string().trim().max(160).optional().nullable(),
  company_name: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  linkedin_url: z.string().trim().max(500).optional().nullable(),
  apollo_person_id: z.string().trim().max(120).optional().nullable(),
});

export async function POST(req: Request) {
  const auth = authorizeIntegration(req, "jarvis", "JARVIS_API_KEY");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  if (ip) {
    const rl = checkRateLimit(`jarvis-match:${ip}`, RATE);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Rate limited. Retry shortly." }, { status: 429 });
    }
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Compute qualifiers from whatever we got. At least ONE must produce a
  // non-null signal — otherwise it's not actually a lookup.
  const qualifiers = computeQualifiers({
    email: data.email,
    first_name: data.first_name,
    last_name: data.last_name,
    full_name: data.full_name,
    phone: data.phone,
    linkedin_url: data.linkedin_url,
    company_name: data.company_name,
    apollo_person_id: data.apollo_person_id,
  });
  const hasAnyQualifier =
    !!(qualifiers.email_normalized ||
      qualifiers.apollo_person_id ||
      qualifiers.phone_digits ||
      qualifiers.name_company_key ||
      qualifiers.linkedin_normalized);
  if (!hasAnyQualifier) {
    return NextResponse.json(
      { error: "Provide at least one lookup field (email, apollo_person_id, phone, linkedin_url, or first_name+last_name+company_name)." },
      { status: 400 },
    );
  }

  try {
    const hit = await lookupExistingLeadByQualifiers(qualifiers, {
      signals: [
        "email_normalized",
        "apollo_person_id",
        "phone_digits",
        "name_company_key",
        "linkedin_normalized",
      ],
    });
    if (!hit) return NextResponse.json({ matched: false });

    const lead = hit.lead as LeadDoc;
    const wf = await loadCurrentWorkflow(lead.contact?.email ?? lead.email_normalized ?? "");

    return NextResponse.json({
      matched: true,
      signal: hit.signal,
      lead_id: hit.id,
      contact_id: lead.contact_id,
      company_id: lead.company_id,
      current_workflow_id: wf.current_workflow_id,
      current_workflow_name: wf.current_workflow_name,
      current_band: wf.current_band,
      status: lead.status,
      created_at: toDate(lead.created_at)?.toISOString() ?? null,
      updated_at: toDate(lead.updated_at)?.toISOString() ?? null,
    });
  } catch (err) {
    // Always log with the external_id (if any) for traceability — Jarvis
    // operators can grep Cloud Run logs to find a specific failure.
    console.error("[jarvis-leads-match] lookup failed", {
      external_id: data.apollo_person_id ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
}
