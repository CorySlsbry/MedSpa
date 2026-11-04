# Deploy

The site is live at **https://medspa-web-1030670077341.us-central1.run.app**

GCP project: `medspa-494718` · region: `us-central1` · service: `medspa-web`

## What's already wired

- ✅ Cloud Run service `medspa-web` running, public, scales 0–10
- ✅ Artifact Registry repo `medspa` (us-central1) for container images
- ✅ Compute service account has Cloud Build, Storage, Artifact Registry, and Run.builder roles
- ✅ Billing linked (Jarvis Billing — switch in Console if you want it routed elsewhere)
- ✅ APIs enabled: `run`, `cloudbuild`, `artifactregistry`
- ✅ Env vars set on Cloud Run: `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, `ADMIN_BOOTSTRAP_EMAIL=cory.salisbury@gmail.com`

## Manual deploy (works today)

From a clean working tree on `main`:

```bash
gcloud run deploy medspa-web \
  --source . \
  --region us-central1 \
  --project medspa-494718 \
  --allow-unauthenticated
```

That's it. The first deploy ran in about 5 minutes. Future deploys are faster since the layer cache is warm.

## Auto-deploy on push (one-time setup)

Cloud Build's GitHub trigger needs an OAuth flow with the GitHub org that gcloud can't fully drive. **One-time manual step:**

1. Open **https://console.cloud.google.com/cloud-build/triggers?project=medspa-494718**
2. Click **"Connect Repository"** (top of page).
3. Pick **GitHub (Cloud Build GitHub App)**, authorize the org, and select **`CorySlsbry/MedSpa`**.
4. Once connected, run this from any shell with gcloud auth:

   ```bash
   gcloud builds triggers create github \
     --project=medspa-494718 \
     --repo-owner=CorySlsbry \
     --repo-name=MedSpa \
     --branch-pattern="^main$" \
     --build-config=cloudbuild.yaml \
     --name=medspa-main-deploy
   ```

5. Done. Every push to `main` will now build via `cloudbuild.yaml` and ship a new Cloud Run revision.

## Setting environment variables

Public env vars (no secrets) update the running service directly:

```bash
gcloud run services update medspa-web \
  --region us-central1 \
  --project medspa-494718 \
  --update-env-vars KEY=value,OTHER=value
```

For secrets (Stripe keys, Resend API key, OAuth refresh tokens), use Secret Manager:

```bash
# Create the secret (one time)
echo -n "re_xxx..." | gcloud secrets create RESEND_API_KEY \
  --data-file=- --project=medspa-494718

# Grant Cloud Run access
gcloud secrets add-iam-policy-binding RESEND_API_KEY \
  --member="serviceAccount:service-account@your-project.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=medspa-494718

# Wire it into the service
gcloud run services update medspa-web \
  --region us-central1 \
  --project medspa-494718 \
  --update-secrets=RESEND_API_KEY=RESEND_API_KEY:latest
```

Repeat for:
- `RESEND_API_KEY` — for demo notifications AND admin magic-link sign-in emails

## CRM database (Firestore) + Identity Platform (one-time)

Total time: ~15 min. Total cost at our volume: **$0/month** (Firestore free tier covers everything).

1. **Provision Firestore + Identity Platform** — follow `firestore/runbooks/01-firestore.md`. Step-by-step gcloud + console commands.
2. **Deploy security rules + indexes** — `firebase deploy --only firestore:rules,firestore:indexes` (Firebase CLI). Or paste from `firestore/security-rules.rules` + `firestore/firestore.indexes.json` into the console.
3. **Wire Cloud Run env vars** — see runbook. Key variables:
   ```bash
   gcloud run services update medspa-web \
     --region=us-central1 --project=medspa-494718 \
     --update-env-vars=NEXT_PUBLIC_FIREBASE_API_KEY=AIza...,ADMIN_BOOTSTRAP_EMAIL=cory.salisbury@gmail.com \
     --update-secrets=RESEND_API_KEY=RESEND_API_KEY:latest
   ```
4. **Grant runtime SA Firestore access**:
   ```bash
   gcloud projects add-iam-policy-binding medspa-494718 \
     --member="serviceAccount:service-account@your-project.iam.gserviceaccount.com" \
     --role="roles/datastore.user" --condition=None
   ```

Until Firestore is wired, `/admin/*` routes fail loudly with a "Firestore not reachable" panel and `/api/demo` returns 500. Marketing landing page continues to work.

## Custom domain (when you're ready)

```bash
gcloud beta run domain-mappings create \
  --service=medspa-web \
  --domain=app.aesthera.io \
  --region=us-central1 \
  --project=medspa-494718
```

That'll print DNS records to add. Cloud Run handles SSL automatically.

## Logs and monitoring

```bash
# Live logs
gcloud run services logs tail medspa-web \
  --region=us-central1 --project=medspa-494718

# Search for demo submissions specifically
gcloud logging read 'jsonPayload.event="platform_demo"' \
  --project=medspa-494718 --limit=20
```

Cloud Run also gives you the URL, request count, latency, and error rate at:
https://console.cloud.google.com/run/detail/us-central1/medspa-web?project=medspa-494718
