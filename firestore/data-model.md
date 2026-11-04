# Aesthera CRM — Firestore data model

Single Firestore database (`(default)` instance), Native mode. All collections
are top-level. There's no per-tenant scoping in Phase 1 because the CRM is
used by Cory only as super-admin. The in-app multi-tenant CRM that ships with
the SaaS product itself is a separate Firestore database (Phase 2+).

## Collections

| Collection | Doc ID strategy | Notes |
|---|---|---|
| `users` | Firebase UID | Identity Platform user mapping + role |
| `login_attempts` | auto | Telemetry for sign-in attempts |
| `companies` | auto | Clinics. `name_lower` indexed for case-insensitive lookup |
| `contacts` | **lowercased email** | Email-as-ID gives us free uniqueness + O(1) upsert |
| `tags` | slug | Categorization labels |
| `pipeline_stages` | slug | Funnel stages (configurable) |
| `leads` | auto | One per /api/demo submission. Snapshots contact + company at capture. |
| `deals` | auto | Sales-pipeline opportunities. Founding-25 spots numbered 1..25. |
| `activities` | auto | Generic timeline events |
| `notes` | auto | Free-form notes |
| `tasks` | auto | Cory's follow-ups |
| `audit_log` | auto | **Append-only**. Security rules deny update + delete. |

## Denormalization strategy

Firestore has no joins. We denormalize for read-optimized queries:

- `leads` documents store **snapshots** of contact and company at capture time
  (`contact: { email, full_name, phone, role }` and `company: { name, type,
  locations_count }`). This means the leads list query is one collection scan,
  no joins. Updating a contact does NOT backfill prior leads — leads are
  intentionally a moment-in-time record.
- `contacts` documents carry `company_id` and `company_name` for the same
  reason.
- `companies` documents carry `contact_count` and `lead_count` as denormalized
  counters, updated atomically via `FieldValue.increment(1)` from the
  lead-capture transaction.

When data shape evolves and these counters / snapshots drift, run a one-off
backfill script (none needed yet).

## Required composite indexes

Firestore auto-creates single-field indexes. Composite indexes must be defined.
The first time a query runs that needs one, the Admin SDK throws a clear
error message with a link to create it. For predictability, declare them
upfront via `firebase.json` + `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "leads",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "created_at", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "leads",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "interest", "order": "ASCENDING" },
        { "fieldPath": "created_at", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "deals",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "is_founding_25", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    }
  ]
}
```

Apply via the runbook (`firestore/runbooks/01-firestore.md`).

## Cost shape at low volume

- Reads: free up to 50K/day, then $0.06 / 100K reads
- Writes: free up to 20K/day, then $0.18 / 100K writes
- Storage: free up to 1 GiB, then $0.18 / GiB / month
- Network egress: free up to 10 GiB/month outbound to NA, then $0.12 / GiB

For Aesthera Phase 1 (Cory + occasional admin reads + low-volume lead
capture), we'll likely sit at $0/month indefinitely. The first $20+ in
billing only kicks in if we hit thousands of reads per day.
