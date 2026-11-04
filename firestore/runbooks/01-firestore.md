# Firestore + Identity Platform setup — Aesthera CRM

Total time: ~15 minutes. Total recurring cost at our volume: **$0/month.**

## 1. Enable APIs (1 min)

```bash
gcloud services enable \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com \
  --project=medspa-494718
```

## 2. Create Firestore database in Native mode (3 min)

Console (one-time, regional choice is permanent):
1. Open https://console.cloud.google.com/firestore?project=medspa-494718
2. Click **Create database**
3. Choose **Native mode** (NOT Datastore mode — that's a different product)
4. Region: **nam5** (multi-region US) for HA, or **us-central1** for single-region cheaper
5. Security rules: starts in test mode (open). Don't worry — we deploy our own rules in step 4.

Or via gcloud:
```bash
gcloud firestore databases create \
  --location=nam5 \
  --type=firestore-native \
  --project=medspa-494718
```

## 3. Set up Identity Platform (5 min)

1. Open https://console.cloud.google.com/customer-identity?project=medspa-494718
2. Click **Get Started** if first time.
3. Under **Providers** → enable **Email / Password** with **Email link (passwordless sign-in)** checked.
4. **Settings → Authorized domains**, add:
   - `medspa-web-1030670077341.us-central1.run.app`
   - `localhost` (local dev)
   - `aesthera.io` (when you set up the custom domain)
5. **Settings → User actions** — leave email enumeration protection ON.
6. Copy the **Web API key** shown on the Provider page (`AIza...`) — needed below.

## 4. Deploy security rules + indexes (3 min)

Install the Firebase CLI once:
```bash
npm install -g firebase-tools
firebase login
firebase use medspa-494718
```

From the repo root, deploy rules + indexes:
```bash
firebase deploy --only firestore:rules,firestore:indexes \
  --project medspa-494718 \
  --config firestore/firebase.json
```

(If `firebase.json` doesn't exist yet, create it pointing at the rules + indexes
files in this repo — see step below.)

Or just apply manually in the console:
- Rules: paste contents of `firestore/security-rules.rules` into the Firestore Rules editor
- Indexes: paste contents of `firestore/firestore.indexes.json` into the Indexes config

## 5. Wire Cloud Run env vars (3 min)

```bash
gcloud run services update medspa-web \
  --region=us-central1 --project=medspa-494718 \
  --update-env-vars=NEXT_PUBLIC_FIREBASE_API_KEY=AIza...,ADMIN_BOOTSTRAP_EMAIL=cory.salisbury@gmail.com
```

Resend API key (for the magic-link email + lead notifications):
```bash
echo -n "re_xxx..." | gcloud secrets create RESEND_API_KEY \
  --data-file=- --project=medspa-494718

gcloud secrets add-iam-policy-binding RESEND_API_KEY \
  --member="serviceAccount:service-account@your-project.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=medspa-494718

gcloud run services update medspa-web \
  --region=us-central1 --project=medspa-494718 \
  --update-secrets=RESEND_API_KEY=RESEND_API_KEY:latest
```

## 6. Grant Firestore IAM to the runtime SA

The Cloud Run runtime service account needs to read/write Firestore:

```bash
gcloud projects add-iam-policy-binding medspa-494718 \
  --member="serviceAccount:service-account@your-project.iam.gserviceaccount.com" \
  --role="roles/datastore.user" \
  --condition=None
```

## 7. Verify

Trigger a deploy (push to main, or run the manual deploy from `DEPLOY.md`),
then:

```bash
# Submit a test lead
curl -X POST https://medspa-web-1030670077341.us-central1.run.app/api/demo \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"test+demo@example.com","clinic_name":"Test Spa","interest":"demo"}'

# Open https://medspa-web-1030670077341.us-central1.run.app/admin/login
# Enter cory.salisbury@gmail.com → check inbox → click link
# You should land on /admin with the test lead visible.
```

## Phase 2 hardening (when PHI lands)

- **Require MFA** on the super-admin role — Identity Platform supports SMS,
  TOTP, hardware security keys.
- **Review security rules** — they currently allow super_admin full access.
  When other roles enter the picture, scope per-tenant.
- **Audit log retention** — Firestore doesn't auto-archive. Set up a Cloud
  Function that exports old audit rows to Cloud Storage for long-term retention.
- **Backups** — Firestore supports scheduled backups via the Firebase CLI or
  Cloud Scheduler + Cloud Functions. Free tier covers it.
