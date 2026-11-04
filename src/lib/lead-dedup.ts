/**
 * Lead dedup qualifier computation + lookup.
 *
 * Source-of-truth implementation of the normalization rules used to
 * detect when two prospect pushes refer to the same human at the same
 * company. The rules MUST match the Jarvis-side helper in
 * `src/lib/leads/composite-dedup.ts` so a key computed on either side
 * hashes identically — silent drift would let duplicates through.
 *
 * Lookup priority (first hit wins) on POST ingest + /match endpoints:
 *   1. email_normalized
 *   2. apollo_person_id
 *   3. phone_digits
 *   4. name_company_key
 *   5. linkedin_normalized   (used by /match only; never overrides 1-4)
 *
 * Firestore note: Firestore doesn't have unique constraints. We approach
 * "one lead per identity" via transactional lookup-or-merge on every
 * ingest. Two concurrent writes for the same email retry-loop on tx
 * conflict so the second one sees the first one's write, then merges.
 */

import { db } from "./firestore";
import type { LeadDoc } from "./firestore-types";

// ── Normalization ──────────────────────────────────────────────────────────

export function normalizeEmail(s: string | null | undefined): string | null {
  if (!s) return null;
  const n = s.trim().toLowerCase();
  return n || null;
}

/**
 * Strip every non-digit. If the result is 11 digits AND starts with "1"
 * (US country code), drop the leading "1" so a +1-prefixed and
 * un-prefixed number normalize to the same value.
 */
export function normalizePhone(s: string | null | undefined): string | null {
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/**
 * Lowercase, trim, strip the common entity-suffix vocabulary, strip a
 * fixed punctuation set, collapse whitespace. Two different LLC vs Inc.
 * spellings of the same brand collapse to the same key.
 *
 * Suffix list MUST match the Jarvis helper. If we add to one, we add to
 * the other in lockstep.
 */
const COMPANY_SUFFIX_RE =
  /\b(inc|llc|ltd|co|corp|corporation|company|group|holdings|enterprises|services|llp|p\.c\.|pc|pa)\b\.?/gi;

const COMPANY_PUNCT_RE = /[.,&'/()[\]]/g;

export function normalizeCompany(s: string | null | undefined): string | null {
  if (!s) return null;
  let out = s.toLowerCase().trim();
  out = out.replace(COMPANY_SUFFIX_RE, "");
  out = out.replace(COMPANY_PUNCT_RE, "");
  out = out.replace(/\s+/g, " ").trim();
  return out || null;
}

/**
 * lowercase the URL, strip trailing slashes, drop the query string.
 * `https://www.linkedin.com/in/cory/?utm_source=...` → `linkedin.com/in/cory`.
 */
export function normalizeLinkedin(s: string | null | undefined): string | null {
  if (!s) return null;
  let out = s.trim().toLowerCase();
  // strip protocol + www.
  out = out.replace(/^https?:\/\//, "").replace(/^www\./, "");
  // drop query string
  const q = out.indexOf("?");
  if (q >= 0) out = out.slice(0, q);
  // drop hash
  const h = out.indexOf("#");
  if (h >= 0) out = out.slice(0, h);
  // strip trailing slashes
  out = out.replace(/\/+$/, "");
  return out || null;
}

/**
 * Build the composite name+company key. Falls back to splitting full_name
 * on whitespace when first/last aren't supplied. Returns null when any
 * required component is missing — null keys never match anything, which
 * is the correct behavior.
 */
export function buildNameCompanyKey(args: {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  company_name?: string | null;
}): string | null {
  let first = (args.first_name ?? "").trim();
  let last = (args.last_name ?? "").trim();
  if ((!first || !last) && args.full_name) {
    const parts = args.full_name.trim().split(/\s+/);
    if (parts.length >= 2) {
      first = first || parts[0];
      last = last || parts[parts.length - 1];
    }
  }
  const company = normalizeCompany(args.company_name ?? null);
  if (!first || !last || !company) return null;
  return `${first.toLowerCase()} ${last.toLowerCase()}|${company}`;
}

// ── Combined qualifier computation ─────────────────────────────────────────

export type DedupQualifiers = {
  email_normalized: string | null;
  phone_digits: string | null;
  linkedin_normalized: string | null;
  name_company_key: string | null;
  apollo_person_id: string | null;
  external_id: string | null;
};

export type DedupSignal =
  | "email_normalized"
  | "apollo_person_id"
  | "phone_digits"
  | "name_company_key"
  | "linkedin_normalized";

export function computeQualifiers(args: {
  email?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  company_name?: string | null;
  apollo_person_id?: string | null;
  external_id?: string | null;
}): DedupQualifiers {
  return {
    email_normalized: normalizeEmail(args.email ?? null),
    phone_digits: normalizePhone(args.phone ?? null),
    linkedin_normalized: normalizeLinkedin(args.linkedin_url ?? null),
    name_company_key: buildNameCompanyKey({
      first_name: args.first_name ?? null,
      last_name: args.last_name ?? null,
      full_name: args.full_name ?? null,
      company_name: args.company_name ?? null,
    }),
    apollo_person_id:
      args.apollo_person_id && args.apollo_person_id.trim()
        ? args.apollo_person_id.trim()
        : null,
    external_id:
      args.external_id && args.external_id.trim() ? args.external_id.trim() : null,
  };
}

// ── Lookup ─────────────────────────────────────────────────────────────────

/**
 * Find an existing lead by qualifier in priority order. Returns the first
 * match or null. Each lookup is an indexed equality query with limit(1).
 *
 * Optionally pass a Firestore transaction to perform the read inside the
 * ingest tx so concurrent writes don't race.
 *
 * The `signals` arg lets callers limit which fields participate. POST
 * ingest uses the first 4 (email→apollo→phone→name_company); /match adds
 * linkedin as a 5th fallback.
 */
export async function lookupExistingLeadByQualifiers(
  q: DedupQualifiers,
  options?: {
    signals?: DedupSignal[];
    transaction?: FirebaseFirestore.Transaction;
  },
): Promise<{ id: string; lead: LeadDoc; signal: DedupSignal } | null> {
  const order: DedupSignal[] =
    options?.signals ??
    [
      "email_normalized",
      "apollo_person_id",
      "phone_digits",
      "name_company_key",
    ];

  for (const sig of order) {
    const value = q[sig];
    if (!value) continue;
    const query = db().collection("leads").where(sig, "==", value).limit(1);
    const snap = options?.transaction
      ? await options.transaction.get(query)
      : await query.get();
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, lead: d.data() as LeadDoc, signal: sig };
    }
  }
  return null;
}

/**
 * Merge the result back to a single API response shape. Used by the POST
 * ingest extended response + /match endpoint.
 */
export function qualifiersToResponse(q: DedupQualifiers): DedupQualifiers {
  // Pure passthrough today — exists so we have one place to filter or
  // rename fields if we ever evolve the public shape without breaking
  // the storage shape.
  return { ...q };
}
