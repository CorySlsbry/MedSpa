/**
 * One-time backfill: populate dedup qualifier fields on every existing
 * lead. Idempotent — re-running just refreshes from the same source
 * fields. Safe to run before AND after the new POST ingest is live.
 *
 * Run:
 *   node scripts/backfill-lead-qualifiers.mjs
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`.
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault(), projectId: "medspa-494718" });
const db = getFirestore();

// Mirror src/lib/lead-dedup.ts exactly. Drift here = duplicates slip
// through. Keep these in sync.
const COMPANY_SUFFIX_RE =
  /\b(inc|llc|ltd|co|corp|corporation|company|group|holdings|enterprises|services|llp|p\.c\.|pc|pa)\b\.?/gi;
const COMPANY_PUNCT_RE = /[.,&'/()[\]]/g;

function normalizeEmail(s) {
  if (!s) return null;
  const n = s.trim().toLowerCase();
  return n || null;
}
function normalizePhone(s) {
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}
function normalizeCompany(s) {
  if (!s) return null;
  let out = s.toLowerCase().trim();
  out = out.replace(COMPANY_SUFFIX_RE, "");
  out = out.replace(COMPANY_PUNCT_RE, "");
  out = out.replace(/\s+/g, " ").trim();
  return out || null;
}
function normalizeLinkedin(s) {
  if (!s) return null;
  let out = s.trim().toLowerCase();
  out = out.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const q = out.indexOf("?");
  if (q >= 0) out = out.slice(0, q);
  const h = out.indexOf("#");
  if (h >= 0) out = out.slice(0, h);
  out = out.replace(/\/+$/, "");
  return out || null;
}
function buildNameCompanyKey(args) {
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

let updated = 0;
let unchanged = 0;
let processed = 0;

const PAGE = 500;
let cursor = null;

while (true) {
  let q = db.collection("leads").orderBy("__name__").limit(PAGE);
  if (cursor) q = q.startAfter(cursor);
  const snap = await q.get();
  if (snap.empty) break;

  const batch = db.batch();
  for (const d of snap.docs) {
    processed++;
    const data = d.data();
    const apolloId =
      data.raw_payload?.apollo_person_id ?? data.raw_payload?.apollo_id ?? null;
    const externalId =
      data.raw_payload?.external_id ?? data.external_id ?? null;
    const linkedin =
      data.raw_payload?.linkedin_url ?? data.contact?.linkedin_url ?? null;

    const target = {
      email_normalized: normalizeEmail(data.contact?.email ?? null),
      phone_digits: normalizePhone(data.contact?.phone ?? null),
      linkedin_normalized: normalizeLinkedin(linkedin),
      name_company_key: buildNameCompanyKey({
        first_name: data.contact?.first_name ?? null,
        last_name: data.contact?.last_name ?? null,
        full_name: data.contact?.full_name ?? null,
        company_name: data.company?.name ?? null,
      }),
      apollo_person_id: apolloId,
      external_id: externalId,
      // backfill soft-delete column too if missing
      ...(data.deleted_at === undefined ? { deleted_at: null } : {}),
    };

    // Skip if all qualifier fields already match what we'd write
    const same =
      data.email_normalized === target.email_normalized &&
      data.phone_digits === target.phone_digits &&
      data.linkedin_normalized === target.linkedin_normalized &&
      data.name_company_key === target.name_company_key &&
      data.apollo_person_id === target.apollo_person_id &&
      data.external_id === target.external_id &&
      data.deleted_at !== undefined;
    if (same) {
      unchanged++;
      continue;
    }
    batch.update(d.ref, target);
    updated++;
  }
  await batch.commit();

  if (snap.size < PAGE) break;
  cursor = snap.docs[snap.docs.length - 1];
}

console.log(JSON.stringify({ processed, updated, unchanged }));
