/**
 * POST /api/integrations/jarvis/leads
 *
 * Service-to-service ingest endpoint for the Jarvis platform's Apollo
 * prospecting flow. One transactional call per prospect:
 *   1. Upsert contact (doc id = lowercased email)
 *   2. Find-or-create company by name_lower (creates if not present)
 *   3. Insert lead with snapshotted contact + company
 *   4. Merge tags onto the contact (dedup'd)
 *   5. Optionally enroll into one or more workflows (cooldown + dup-protected)
 *   6. Append audit row
 *
 * Auth: `Authorization: Bearer <JARVIS_API_KEY>` (key in Secret Manager).
 * Idempotency: contact + company keyed by stable identifiers, so re-pushing
 * the same prospect updates fields rather than creating duplicates. Leads
 * remain a moment-in-time capture (each push = new LeadDoc) so
 * attribution and source remain interpretable.
 *
 * Rate limit: 60 req/min per IP (token bucket; in-memory). For higher
 * burst, batch on the caller side or move to a queue (out of scope).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp, FieldValue, type Transaction } from "firebase-admin/firestore";
import { db, now, toDate } from "@/lib/firestore";
import { loadCurrentWorkflow } from "@/lib/lead-current-workflow";
import { writeAuditInTx } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { authorizeIntegration } from "@/lib/integrations-auth";
import { enrollContactInWorkflow } from "@/lib/workflows";
import {
  computeQualifiers,
  lookupExistingLeadByQualifiers,
  type DedupQualifiers,
  type DedupSignal,
} from "@/lib/lead-dedup";
import type {
  CompanyDoc,
  CompanyType,
  ContactDoc,
  ContactRole,
  LeadDoc,
  LeadInterest,
  LeadSource,
  LocationsBucket,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1,200/min (20 per second) — enough headroom for a 10k-lead batch in
// ~8 minutes without rate-limiting honest pushes from the Jarvis worker.
// The pre-tx upserts (company find-or-create + contact upsert) keep
// Firestore writes throttled below the per-collection 1k/sec ceiling
// even at this capacity, since each lead = ~3 writes.
const RATE = { capacity: 1200, windowMs: 60 * 1000 };

const COMPANY_TYPES: CompanyType[] = [
  "med_spa",
  "aesthetic_clinic",
  "iv_lounge",
  "wellness_studio",
  "lash_brow_studio",
  "head_spa",
  "other",
  "unknown",
];

const LOCATIONS_BUCKETS: LocationsBucket[] = ["1", "2-3", "4-9", "10+", "unknown"];

const CONTACT_ROLES: ContactRole[] = [
  "owner",
  "medical_director",
  "manager",
  "provider",
  "other",
];

const LEAD_SOURCES: LeadSource[] = ["marketing_site", "referral", "cold", "partner", "event", "other"];
const LEAD_INTERESTS: LeadInterest[] = ["demo", "early_access", "pricing", "other"];

const Body = z.object({
  contact: z.object({
    email: z.string().trim().toLowerCase().email().max(320),
    full_name: z.string().trim().max(160).optional().nullable(),
    /** Optional first/last for stricter name_company_key construction.
     * Falls back to splitting full_name when omitted. */
    first_name: z.string().trim().max(80).optional().nullable(),
    last_name: z.string().trim().max(80).optional().nullable(),
    phone: z.string().trim().max(40).optional().nullable(),
    /** Optional LinkedIn URL — used as a fallback dedup signal in /match. */
    linkedin_url: z.string().trim().max(500).optional().nullable(),
    /** Optional Apollo person id — second-priority dedup signal after email. */
    apollo_person_id: z.string().trim().max(120).optional().nullable(),
    role: z.enum(["owner", "medical_director", "manager", "provider", "other"]).optional().nullable(),
    title: z.string().trim().max(160).optional().nullable(),
  }),
  company: z
    .object({
      name: z.string().trim().min(1).max(200),
      type: z.enum([
        "med_spa",
        "aesthetic_clinic",
        "iv_lounge",
        "wellness_studio",
        "lash_brow_studio",
        "head_spa",
        "other",
        "unknown",
      ]).default("unknown"),
      website: z.string().trim().max(300).optional().nullable(),
      city: z.string().trim().max(120).optional().nullable(),
      state: z.string().trim().max(60).optional().nullable(),
      country: z.string().trim().max(60).default("US"),
      locations_count: z.enum(["1", "2-3", "4-9", "10+", "unknown"]).optional().nullable(),
    })
    .optional()
    .nullable(),
  lead: z
    .object({
      source: z.enum(["marketing_site", "referral", "cold", "partner", "event", "other"]).default("cold"),
      interest: z.enum(["demo", "early_access", "pricing", "other"]).default("other"),
      notes: z.string().trim().max(2000).optional().nullable(),
      utm_source: z.string().trim().max(120).optional().nullable(),
      utm_medium: z.string().trim().max(120).optional().nullable(),
      utm_campaign: z.string().trim().max(120).optional().nullable(),
      raw_payload: z.record(z.string(), z.unknown()).optional().nullable(),
    })
    .optional()
    .default({}),
  tags: z.array(z.string().trim().min(1).max(60)).max(40).optional().default([]),
  enroll_workflow_ids: z.array(z.string().trim().min(1)).max(10).optional().default([]),
  /** Optional client-supplied request id for de-duping retries. Currently advisory. */
  external_id: z.string().trim().max(120).optional().nullable(),
});

export async function POST(req: Request) {
  const auth = authorizeIntegration(req, "jarvis", "JARVIS_API_KEY");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  if (ip) {
    const rl = checkRateLimit(`jarvis-leads:${ip}`, RATE);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limited. Retry shortly." },
        { status: 429 },
      );
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
      {
        error: "Invalid input.",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const ua = req.headers.get("user-agent") || null;

  // Compute dedup qualifiers from the incoming request — done outside the
  // tx so we can pass them in. Pure function, no I/O.
  const qualifiers: DedupQualifiers = computeQualifiers({
    email: data.contact.email,
    first_name: data.contact.first_name,
    last_name: data.contact.last_name,
    full_name: data.contact.full_name,
    phone: data.contact.phone,
    linkedin_url: data.contact.linkedin_url,
    company_name: data.company?.name,
    apollo_person_id: data.contact.apollo_person_id,
    external_id: data.external_id,
  });

  // Transactionally: company find-or-create → contact upsert → lead
  // lookup-merge-or-insert. The merge path catches duplicates at the
  // application layer (Firestore has no unique constraints — see the
  // module-level comment in src/lib/lead-dedup.ts for the race story).
  let result: {
    contact_id: string;
    lead_id: string;
    company_id: string | null;
    company_created: boolean;
    contact_created: boolean;
    match_signal: DedupSignal | null;
    is_fresh_insert: boolean;
  };
  try {
    result = await db().runTransaction(async (trx) => {
      // ── PHASE 1: ALL READS FIRST (Firestore tx rule) ──────────────────
      const contactRef = db().collection("contacts").doc(data.contact.email);
      const companyQuery = data.company
        ? db()
            .collection("companies")
            .where("name_lower", "==", data.company.name.toLowerCase())
            .limit(1)
        : null;

      const [contactSnap, companySnap, existingLead] = await Promise.all([
        trx.get(contactRef),
        companyQuery ? trx.get(companyQuery) : Promise.resolve(null),
        // POST ingest looks up by 4 signals (email, apollo, phone,
        // name_company). Linkedin is a /match-only fallback to keep the
        // POST merge bar tight.
        lookupExistingLeadByQualifiers(qualifiers, {
          signals: [
            "email_normalized",
            "apollo_person_id",
            "phone_digits",
            "name_company_key",
          ],
          transaction: trx,
        }),
      ]);

      // ── PHASE 2: ALL WRITES (no more reads after this point) ──────────

      // Company find-or-create
      let companyId: string | null = null;
      let companyCreated = false;
      let companyType: CompanyType = "unknown";
      let companyLocations: LocationsBucket | null = null;
      let companyName = "";
      if (data.company) {
        companyName = data.company.name;
        companyType = data.company.type as CompanyType;
        companyLocations = (data.company.locations_count ?? null) as LocationsBucket | null;
        if (companySnap && !companySnap.empty) {
          companyId = companySnap.docs[0].id;
          const update: Record<string, unknown> = { updated_at: now() };
          if (data.company.website) update.website = data.company.website;
          if (data.company.city) update.location_city = data.company.city;
          if (data.company.state) update.location_state = data.company.state;
          if (data.company.country) update.location_country = data.company.country;
          if (companyLocations) update.locations_count = companyLocations;
          if (companyType !== "unknown") update.type = companyType;
          trx.update(companySnap.docs[0].ref, update);
        } else {
          const ref = db().collection("companies").doc();
          companyId = ref.id;
          companyCreated = true;
          const doc: Omit<CompanyDoc, "created_at" | "updated_at"> & {
            created_at: ReturnType<typeof now>;
            updated_at: ReturnType<typeof now>;
          } = {
            name: data.company.name,
            name_lower: data.company.name.toLowerCase(),
            type: companyType,
            website: data.company.website ?? null,
            location_city: data.company.city ?? null,
            location_state: data.company.state ?? null,
            location_country: data.company.country,
            locations_count: companyLocations,
            source: "jarvis_apollo",
            notes: null,
            contact_count: 0,
            lead_count: 0,
            created_at: now(),
            updated_at: now(),
          };
          trx.create(ref, doc);
        }
      }

      // Contact upsert
      let contactCreated = false;
      const incomingTags = (data.tags ?? []).map((t) => t.trim()).filter(Boolean);
      let mergedTags: string[];
      if (contactSnap.exists) {
        const cur = contactSnap.data() as ContactDoc;
        const existingTags = Array.isArray(cur.tags) ? cur.tags : [];
        mergedTags = Array.from(new Set([...existingTags, ...incomingTags]));
        const update: Record<string, unknown> = {
          updated_at: now(),
          tags: mergedTags,
        };
        if (data.contact.full_name) update.full_name = data.contact.full_name;
        if (data.contact.phone) update.phone = data.contact.phone;
        if (data.contact.role) update.role = data.contact.role;
        if (companyId) {
          update.company_id = companyId;
          update.company_name = companyName;
        }
        trx.update(contactRef, update);
      } else {
        contactCreated = true;
        mergedTags = Array.from(new Set(incomingTags));
        const doc: Omit<ContactDoc, "created_at" | "updated_at"> & {
          created_at: ReturnType<typeof now>;
          updated_at: ReturnType<typeof now>;
        } = {
          email: data.contact.email,
          full_name: data.contact.full_name ?? null,
          phone: data.contact.phone ?? null,
          role: (data.contact.role as ContactRole) ?? null,
          company_id: companyId,
          company_name: companyName || null,
          do_not_contact: false,
          email_unsubscribed: false,
          sms_unsubscribed: false,
          source: "jarvis_apollo",
          tags: mergedTags,
          created_at: now(),
          updated_at: now(),
        };
        trx.create(contactRef, doc);
      }

      // Lead lookup-merge-or-insert. existingLead was looked up in
      // PHASE 1 against the qualifier columns; if hit, merge fields onto
      // it. Otherwise insert a new lead with qualifiers stamped.
      let leadId: string;
      let matchSignal: DedupSignal | null = null;
      let isFreshInsert = true;

      if (existingLead) {
        // ── MERGE PATH ────────────────────────────────────────────────
        // Update non-empty incoming fields only. We never overwrite an
        // existing populated value with a null from a thinner push.
        leadId = existingLead.id;
        matchSignal = existingLead.signal;
        isFreshInsert = false;
        const leadRef = db().collection("leads").doc(leadId);
        const update: Record<string, unknown> = { updated_at: now() };
        // Contact snapshot — refresh fields that arrived non-empty
        if (data.contact.full_name) update["contact.full_name"] = data.contact.full_name;
        if (data.contact.phone) update["contact.phone"] = data.contact.phone;
        if (data.contact.role) update["contact.role"] = data.contact.role;
        // Company snapshot
        if (companyName) update["company.name"] = companyName;
        if (companyType !== "unknown") update["company.type"] = companyType;
        if (companyLocations) update["company.locations_count"] = companyLocations;
        if (companyId && !existingLead.lead.company_id) update.company_id = companyId;
        // UTM / source / interest — only fill when blank existing
        if (!existingLead.lead.utm_source && data.lead.utm_source) update.utm_source = data.lead.utm_source;
        if (!existingLead.lead.utm_medium && data.lead.utm_medium) update.utm_medium = data.lead.utm_medium;
        if (!existingLead.lead.utm_campaign && data.lead.utm_campaign) update.utm_campaign = data.lead.utm_campaign;
        if (!existingLead.lead.notes && data.lead.notes) update.notes = data.lead.notes;
        // Qualifiers — refresh any that arrived populated. This lets a
        // later push enrich a lead that was created with email-only.
        if (qualifiers.email_normalized && !existingLead.lead.email_normalized)
          update.email_normalized = qualifiers.email_normalized;
        if (qualifiers.phone_digits && !existingLead.lead.phone_digits)
          update.phone_digits = qualifiers.phone_digits;
        if (qualifiers.linkedin_normalized && !existingLead.lead.linkedin_normalized)
          update.linkedin_normalized = qualifiers.linkedin_normalized;
        if (qualifiers.name_company_key && !existingLead.lead.name_company_key)
          update.name_company_key = qualifiers.name_company_key;
        if (qualifiers.apollo_person_id && !existingLead.lead.apollo_person_id)
          update.apollo_person_id = qualifiers.apollo_person_id;
        if (qualifiers.external_id && !existingLead.lead.external_id)
          update.external_id = qualifiers.external_id;
        trx.update(leadRef, update);
      } else {
        // ── INSERT PATH ───────────────────────────────────────────────
        const leadRef = db().collection("leads").doc();
        leadId = leadRef.id;
        const leadDoc: Omit<LeadDoc, "created_at" | "updated_at"> & {
          created_at: ReturnType<typeof now>;
          updated_at: ReturnType<typeof now>;
        } = {
          contact_id: data.contact.email,
          contact: {
            email: data.contact.email,
            full_name: data.contact.full_name ?? null,
            phone: data.contact.phone ?? null,
            role: (data.contact.role as ContactRole) ?? null,
          },
          company_id: companyId,
          company: {
            name: companyName || "(no company)",
            type: companyType,
            locations_count: companyLocations,
          },
          source: data.lead.source as LeadSource,
          interest: data.lead.interest as LeadInterest,
          status: "new",
          raw_payload: data.lead.raw_payload ?? (data.external_id ? { external_id: data.external_id } : null),
          utm_source: data.lead.utm_source ?? "jarvis",
          utm_medium: data.lead.utm_medium ?? "apollo",
          utm_campaign: data.lead.utm_campaign ?? null,
          notes: data.lead.notes ?? null,
          ip,
          user_agent: ua,
          // Dedup qualifiers — top-level for indexed lookup
          email_normalized: qualifiers.email_normalized,
          phone_digits: qualifiers.phone_digits,
          linkedin_normalized: qualifiers.linkedin_normalized,
          name_company_key: qualifiers.name_company_key,
          apollo_person_id: qualifiers.apollo_person_id,
          external_id: qualifiers.external_id,
          deleted_at: null,
          created_at: now(),
          updated_at: now(),
        };
        trx.create(leadRef, leadDoc);

        // Bump company counters only on fresh-insert path
        if (companyId) {
          const cref = db().collection("companies").doc(companyId);
          const inc: Record<string, unknown> = {
            lead_count: FieldValue.increment(1),
            updated_at: now(),
          };
          if (contactCreated) inc.contact_count = FieldValue.increment(1);
          trx.update(cref, inc);
        }
      }

      writeAuditInTx(trx, {
        action: "lead.create",
        actorEmail: data.contact.email,
        targetType: matchSignal ? "lead.jarvis_apollo.merge" : "lead.jarvis_apollo",
        targetId: leadId,
        after: {
          contact_id: data.contact.email,
          company_id: companyId,
          company_name: companyName || null,
          source: data.lead.source,
          interest: data.lead.interest,
          tags: incomingTags,
          enroll_workflow_ids: data.enroll_workflow_ids ?? [],
          contact_created: contactCreated,
          company_created: companyCreated,
          external_id: data.external_id ?? null,
          match_signal: matchSignal,
          is_fresh_insert: isFreshInsert,
        },
        ip,
        userAgent: ua,
      });

      return {
        contact_id: data.contact.email,
        lead_id: leadId,
        company_id: companyId,
        company_created: companyCreated,
        contact_created: contactCreated,
        match_signal: matchSignal,
        is_fresh_insert: isFreshInsert,
      };
    });
  } catch (err) {
    console.error("[jarvis-leads] tx failed", err);
    return NextResponse.json({ error: "Database write failed." }, { status: 500 });
  }

  // Workflow enrollment runs OUTSIDE the parent tx since each enrollment
  // opens its own transaction. Failures here don't roll back the lead —
  // we surface them in the response so the caller can retry just enrollment.
  const enrollments: Array<{
    workflow_id: string;
    enrolled: boolean;
    enrollment_id?: string;
    already_active?: boolean;
    reason?: string;
  }> = [];
  for (const wfId of data.enroll_workflow_ids ?? []) {
    try {
      const r = await enrollContactInWorkflow({
        workflowId: wfId,
        contactId: data.contact.email,
        source: { type: "lead", leadId: result.lead_id },
        actorUserId: null,
        actorEmail: `jarvis-apollo`,
        ip,
        userAgent: ua,
      });
      if (r.ok) {
        enrollments.push({
          workflow_id: wfId,
          enrolled: !r.alreadyActive,
          enrollment_id: r.enrollmentId,
          already_active: r.alreadyActive,
        });
      } else {
        enrollments.push({ workflow_id: wfId, enrolled: false, reason: r.reason });
      }
    } catch (err) {
      console.error("[jarvis-leads] enroll failed", wfId, err);
      enrollments.push({ workflow_id: wfId, enrolled: false, reason: "enroll_error" });
    }
  }

  return NextResponse.json({
    ok: true,
    contact_id: result.contact_id,
    lead_id: result.lead_id,
    company_id: result.company_id,
    contact_created: result.contact_created,
    company_created: result.company_created,
    match_signal: result.match_signal,
    is_fresh_insert: result.is_fresh_insert,
    dedup_qualifiers: qualifiers,
    enrollments,
  });
}

// silence unused import warnings — these come along the type chain
type _Keep = Transaction | (typeof COMPANY_TYPES)[number] | (typeof LOCATIONS_BUCKETS)[number] | (typeof CONTACT_ROLES)[number] | (typeof LEAD_SOURCES)[number] | (typeof LEAD_INTERESTS)[number] | Timestamp;
const _keep: _Keep | null = null;
void _keep;

// ── GET /api/integrations/jarvis/leads ─────────────────────────────────────
//
// Three modes branched by query param:
//   ?email=...        — single lookup by email_normalized
//   ?lead_id=...      — single lookup by doc id
//   ?since=ISO&limit=N&cursor=opaque — paginated "leads updated since"
//
// All return the full lead-with-qualifiers shape. Soft-deleted excluded by
// default; pass ?include_deleted=true to include.
//
// The since-cursor pagination uses orderBy(updated_at, lead_id) — both
// fields together so the cursor is strictly monotonic and durable across
// equal-timestamp ties.

const GET_RATE = { capacity: 120, windowMs: 60 * 1000 };

export async function GET(req: Request) {
  const auth = authorizeIntegration(req, "jarvis", "JARVIS_API_KEY");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  if (ip) {
    const rl = checkRateLimit(`jarvis-leads-get:${ip}`, GET_RATE);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Rate limited. Retry shortly." }, { status: 429 });
    }
  }

  const url = new URL(req.url);
  const emailParam = url.searchParams.get("email");
  const leadIdParam = url.searchParams.get("lead_id");
  const sinceParam = url.searchParams.get("since");
  const limitParam = url.searchParams.get("limit");
  const cursorParam = url.searchParams.get("cursor");
  const includeDeleted = url.searchParams.get("include_deleted") === "true";

  // Mode A — single lookup by email
  if (emailParam) {
    const normalized = emailParam.trim().toLowerCase();
    const snap = await db()
      .collection("leads")
      .where("email_normalized", "==", normalized)
      .limit(1)
      .get();
    if (snap.empty) return NextResponse.json({ found: false, email: normalized });
    const d = snap.docs[0];
    if (!includeDeleted && (d.data() as LeadDoc).deleted_at) {
      return NextResponse.json({ found: false, email: normalized });
    }
    return NextResponse.json({
      found: true,
      lead: await shapeLeadOut(d.id, d.data() as LeadDoc),
    });
  }

  // Mode B — single lookup by lead_id
  if (leadIdParam) {
    const snap = await db().collection("leads").doc(leadIdParam).get();
    if (!snap.exists) return NextResponse.json({ found: false, lead_id: leadIdParam });
    const data = snap.data() as LeadDoc;
    if (!includeDeleted && data.deleted_at) {
      return NextResponse.json({ found: false, lead_id: leadIdParam });
    }
    return NextResponse.json({ found: true, lead: await shapeLeadOut(snap.id, data) });
  }

  // Mode C — paginated since-cursor list
  if (!sinceParam) {
    return NextResponse.json(
      { error: "Provide ?email=..., ?lead_id=..., or ?since=ISO for paginated mode." },
      { status: 400 },
    );
  }

  const sinceDate = new Date(sinceParam);
  if (Number.isNaN(sinceDate.getTime())) {
    return NextResponse.json({ error: "Invalid `since` ISO timestamp." }, { status: 400 });
  }
  const limit = Math.min(500, Math.max(1, parseInt(limitParam ?? "100", 10) || 100));

  let query = db()
    .collection("leads")
    .where("updated_at", ">=", Timestamp.fromDate(sinceDate))
    .orderBy("updated_at", "asc")
    .orderBy("__name__", "asc")
    .limit(limit + 1) as FirebaseFirestore.Query;

  if (cursorParam) {
    const decoded = decodeCursor(cursorParam);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
    }
    query = query.startAfter(Timestamp.fromDate(decoded.updated_at), decoded.lead_id);
  }

  const snap = await query.get();
  const docs = snap.docs.slice(0, limit);
  const hasMore = snap.docs.length > limit;
  const filtered = includeDeleted
    ? docs
    : docs.filter((d) => !(d.data() as LeadDoc).deleted_at);

  // Batch the per-lead workflow + contact-tags lookups so paginated mode
  // doesn't N+1 against Firestore. With limit=500, we'd otherwise issue
  // ~1000 single-doc reads — the chunked `where __name__ in` form turns
  // that into ~17 reads per collection (30 ids per chunk).
  const out = await shapeLeadsBatch(filtered);
  let nextCursor: string | null = null;
  if (hasMore && docs.length > 0) {
    const last = docs[docs.length - 1].data() as LeadDoc;
    const lastUpdatedAt = toDate(last.updated_at);
    if (lastUpdatedAt) {
      nextCursor = encodeCursor({ updated_at: lastUpdatedAt, lead_id: docs[docs.length - 1].id });
    }
  }

  return NextResponse.json({
    leads: out,
    next_cursor: nextCursor,
    count: out.length,
    has_more: hasMore,
  });
}

// ── Shape helpers ──────────────────────────────────────────────────────────

/**
 * Batch shape: hydrate workflow + contact tags for many leads with a
 * minimal number of Firestore round-trips. Used by Mode C paginated GET
 * where N+1 lookups would blow the 500ms target.
 */
async function shapeLeadsBatch(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
): Promise<Record<string, unknown>[]> {
  const leads = docs.map((d) => ({ id: d.id, data: d.data() as LeadDoc }));
  const contactIds = Array.from(
    new Set(
      leads.map((l) => l.data.contact_id).filter((id): id is string => !!id),
    ),
  );
  const emails = Array.from(
    new Set(
      leads
        .map((l) => l.data.contact?.email ?? l.data.email_normalized ?? null)
        .filter((e): e is string => !!e),
    ),
  );

  // Batch contact tags: chunks of 30 (Firestore `in` cap)
  const tagsByContact = new Map<string, string[]>();
  for (let i = 0; i < contactIds.length; i += 30) {
    const chunk = contactIds.slice(i, i + 30);
    const snap = await db()
      .collection("contacts")
      .where("__name__", "in", chunk)
      .get()
      .catch(() => null);
    if (!snap) continue;
    for (const c of snap.docs) {
      const data = c.data() as { tags?: unknown };
      tagsByContact.set(
        c.id,
        Array.isArray(data.tags) ? (data.tags as string[]) : [],
      );
    }
  }

  // Batch active workflow enrollments by contact_email. We pull all active
  // enrollments for the matching emails in chunks, then pick the most
  // recent per email client-side.
  const wfByEmail = new Map<string, { id: string; name: string; ts: number }>();
  for (let i = 0; i < emails.length; i += 30) {
    const chunk = emails.slice(i, i + 30);
    const snap = await db()
      .collection("workflow_enrollments")
      .where("contact_email", "in", chunk)
      .where("status", "==", "active")
      .get()
      .catch(() => null);
    if (!snap) continue;
    for (const d of snap.docs) {
      const e = d.data() as {
        contact_email?: string;
        workflow_id?: string;
        workflow_name?: string;
        enrolled_at?: { toMillis?: () => number };
      };
      const email = e.contact_email ?? "";
      const ts = e.enrolled_at?.toMillis?.() ?? 0;
      const prior = wfByEmail.get(email);
      if (!prior || ts > prior.ts) {
        wfByEmail.set(email, {
          id: e.workflow_id ?? "",
          name: e.workflow_name ?? "",
          ts,
        });
      }
    }
  }

  return leads.map(({ id, data }) => {
    const email = data.contact?.email ?? data.email_normalized ?? "";
    const wf = wfByEmail.get(email);
    const wfName = wf?.name ?? null;
    const lower = (wfName ?? "").toLowerCase();
    const band: "short" | "long" | null = lower.includes("short")
      ? "short"
      : lower.includes("long")
        ? "long"
        : null;
    return {
      lead_id: id,
      contact_id: data.contact_id,
      company_id: data.company_id,
      email: data.contact?.email ?? data.email_normalized,
      full_name: data.contact?.full_name ?? null,
      phone: data.contact?.phone ?? null,
      title: null,
      company_name: data.company?.name ?? null,
      company_type: data.company?.type ?? null,
      external_id: data.external_id ?? null,
      source: data.source,
      current_workflow_id: wf ? wf.id : null,
      current_workflow_name: wfName,
      current_band: band,
      status: data.status,
      tags: (data.contact_id && tagsByContact.get(data.contact_id)) || [],
      created_at: toDate(data.created_at)?.toISOString() ?? null,
      updated_at: toDate(data.updated_at)?.toISOString() ?? null,
      dedup_qualifiers: {
        email_normalized: data.email_normalized ?? null,
        phone_digits: data.phone_digits ?? null,
        linkedin_normalized: data.linkedin_normalized ?? null,
        name_company_key: data.name_company_key ?? null,
        apollo_person_id: data.apollo_person_id ?? null,
        external_id: data.external_id ?? null,
      },
    };
  });
}

async function shapeLeadOut(leadId: string, lead: LeadDoc): Promise<Record<string, unknown>> {
  const wf = await loadCurrentWorkflow(lead.contact?.email ?? lead.email_normalized ?? "");
  // Pull tags from the linked contact doc (defensive — contact may not exist
  // for legacy rows). One small read; cheap enough at the page sizes we cap.
  let tags: string[] = [];
  if (lead.contact_id) {
    const c = await db().collection("contacts").doc(lead.contact_id).get().catch(() => null);
    const data = c?.data() as { tags?: unknown } | undefined;
    if (data && Array.isArray(data.tags)) tags = data.tags as string[];
  }
  return {
    lead_id: leadId,
    contact_id: lead.contact_id,
    company_id: lead.company_id,
    email: lead.contact?.email ?? lead.email_normalized,
    full_name: lead.contact?.full_name ?? null,
    phone: lead.contact?.phone ?? null,
    title: null, // not currently stored on LeadDoc.contact — surfaced from contact doc if needed later
    company_name: lead.company?.name ?? null,
    company_type: lead.company?.type ?? null,
    external_id: lead.external_id ?? null,
    source: lead.source,
    current_workflow_id: wf.current_workflow_id,
    current_workflow_name: wf.current_workflow_name,
    current_band: wf.current_band,
    status: lead.status,
    tags,
    created_at: toDate(lead.created_at)?.toISOString() ?? null,
    updated_at: toDate(lead.updated_at)?.toISOString() ?? null,
    dedup_qualifiers: {
      email_normalized: lead.email_normalized ?? null,
      phone_digits: lead.phone_digits ?? null,
      linkedin_normalized: lead.linkedin_normalized ?? null,
      name_company_key: lead.name_company_key ?? null,
      apollo_person_id: lead.apollo_person_id ?? null,
      external_id: lead.external_id ?? null,
    },
  };
}

function encodeCursor(args: { updated_at: Date; lead_id: string }): string {
  const payload = JSON.stringify({
    u: args.updated_at.toISOString(),
    l: args.lead_id,
  });
  return Buffer.from(payload).toString("base64url");
}

function decodeCursor(s: string): { updated_at: Date; lead_id: string } | null {
  try {
    const json = Buffer.from(s, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as { u?: string; l?: string };
    if (!parsed.u || !parsed.l) return null;
    const d = new Date(parsed.u);
    if (Number.isNaN(d.getTime())) return null;
    return { updated_at: d, lead_id: parsed.l };
  } catch {
    return null;
  }
}
