# MedSpa

> **Portfolio snapshot.** A sanitized, history-free copy of a private repository, published to show the work.
> Credentials, customer and lead data, internal notes and third-party material were removed, and real client
> and people names were replaced with fictional ones, so this copy is not meant to run as-is.

- **What it is:** Multi-location B2B SaaS and CRM for med spas, aesthetic clinics, IV lounges and wellness studios.
- **Stack:** Next.js, React, Tailwind, Firebase, Firebase Admin, Stripe, Anthropic Claude API, Zod
- **Languages:** TypeScript, JavaScript, CSS, Shell
- **Private repo history:** 98 commits, 2026-04-28 to 2026-05-06
- **This snapshot:** 389 files
- **Built by:** Cory Salisbury, with Claude Code

_All rights reserved. Shared for portfolio review only; no license is granted to copy, modify or redistribute this code._

---

Multi-location B2B SaaS and CRM for med spas, aesthetic clinics, IV lounges, and wellness studios.

**Status:** Phase 0 — landing page + demo capture live. Phase 1 (real auth, Cloud SQL, portals with real data) in progress.

## Stack

- **Frontend & API:** Next.js 15 (App Router, standalone output)
- **Hosting:** Google Cloud Run (project `medspa-494718`, region `us-central1`)
- **CI/CD:** Cloud Build trigger on push to `main`
- **Database (Phase 1):** Cloud SQL Postgres 16 with row-level security
- **Auth (Phase 1):** Google Cloud Identity Platform, multi-tenant
- **AI (Phase 1):** Vertex AI / Gemini for treatment plans + marketing copy
- **Storage (Phase 1):** Cloud Storage with CMEK for clinical photos
- **Real-time (Phase 1):** Firestore Native mode

100% Google Cloud — no third-party DBs.

## Routes

| Path | Purpose |
|---|---|
| `/` | Marketing landing page with three-tier pricing + Founding-25 offer |
| `/sign-in` | Auth placeholder (Identity Platform wires in Phase 1) |
| `/owner` | Owner dashboard shell — KPIs, multi-location revenue, alerts |
| `/provider` | Provider "Today" view — schedule, AI plan badges |
| `/client` | Client home — next visit, AI recommendations, photo gallery |
| `/api/demo` | Lead-capture endpoint (Google Sheets append + Resend notify) |

## Local development

```bash
npm install
cp .env.example .env.local   # fill in keys you need
npm run dev                   # http://localhost:3000
```

Type-check + build:

```bash
npx tsc --noEmit
npm run build
```

## Deploy

Auto-deploys on push to `main` via Cloud Build.

Manual one-shot deploy from a clean working tree:

```bash
gcloud run deploy medspa-web \
  --source . \
  --region us-central1 \
  --project medspa-494718 \
  --allow-unauthenticated
```

## Founder

Cory Salisbury · cory.salisbury@gmail.com

The bootstrap super-admin email is wired via `ADMIN_BOOTSTRAP_EMAIL` env var so when Identity Platform comes online in Phase 1, that account is auto-elevated on first sign-in. No password stored anywhere in this repo.
