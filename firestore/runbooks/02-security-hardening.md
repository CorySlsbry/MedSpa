# Aesthera — Security hardening runbook

The codebase ships with strong defaults: TOTP 2FA, account lockout, audit
logging, security headers, rate limiting, and email alerts on new sign-in
locations. This runbook covers the **operational** controls that live
outside the code — the things a human has to click or sign.

Run them in order. Each one is reversible.

## 1. HIPAA Business Associate Agreement (BAA) with Google Cloud

Required if the platform will ever store PHI (provider charts, client
photos, etc.). Free. ~10 minutes.

1. Open https://console.cloud.google.com/iam-admin/audit?project=medspa-494718
2. Sidebar → **Compliance & assurance** → **HIPAA**
3. Click **Sign Business Associate Agreement**
4. Read it, sign it. Google countersigns and emails confirmation.
5. Once signed, the GCP-services-in-scope list is binding. Verify Aesthera's
   stack (Cloud Run, Firestore, Identity Platform, Cloud Storage, Secret
   Manager, Cloud Logging) is in scope.

If you skip this step but later store PHI, you're out of compliance.

## 2. Cloud Armor — DDoS + WAF + bot protection

Sits in front of Cloud Run via a Load Balancer. ~$5/mo + $1 per rule. ~30 minutes.

```bash
PROJECT=medspa-494718
REGION=us-central1
SERVICE=medspa-web

# 1. Reserve a static IP
gcloud compute addresses create aesthera-lb-ip \
  --network-tier=PREMIUM --ip-version=IPV4 \
  --global --project=$PROJECT

# 2. Create a serverless NEG pointing at Cloud Run
gcloud compute network-endpoint-groups create aesthera-neg \
  --region=$REGION --network-endpoint-type=serverless \
  --cloud-run-service=$SERVICE --project=$PROJECT

# 3. Backend service
gcloud compute backend-services create aesthera-backend \
  --global --load-balancing-scheme=EXTERNAL_MANAGED \
  --project=$PROJECT
gcloud compute backend-services add-backend aesthera-backend \
  --global --network-endpoint-group=aesthera-neg \
  --network-endpoint-group-region=$REGION \
  --project=$PROJECT

# 4. URL map + HTTPS proxy + forwarding rule (managed cert when domain is wired)
gcloud compute url-maps create aesthera-urlmap \
  --default-service=aesthera-backend --project=$PROJECT
# (additional cert + forwarding-rule commands when you wire aesthera.io)

# 5. Cloud Armor security policy
gcloud compute security-policies create aesthera-armor \
  --description="Aesthera WAF + bot rules" --project=$PROJECT
# Pre-baked rules (OWASP top-10 coverage)
gcloud compute security-policies rules create 1000 --security-policy=aesthera-armor \
  --expression="evaluatePreconfiguredExpr('xss-v33-stable')" --action=deny-403 \
  --project=$PROJECT
gcloud compute security-policies rules create 1100 --security-policy=aesthera-armor \
  --expression="evaluatePreconfiguredExpr('sqli-v33-stable')" --action=deny-403 \
  --project=$PROJECT
# Rate-limit /api/demo more aggressively
gcloud compute security-policies rules create 2000 --security-policy=aesthera-armor \
  --expression="request.path.matches('/api/demo')" \
  --action=rate-based-ban --rate-limit-threshold-count=20 \
  --rate-limit-threshold-interval-sec=60 --ban-duration-sec=600 \
  --conform-action=allow --exceed-action=deny-429 \
  --enforce-on-key=IP --project=$PROJECT
gcloud compute backend-services update aesthera-backend \
  --security-policy=aesthera-armor --global --project=$PROJECT
```

## 3. reCAPTCHA Enterprise on `/api/demo` and `/admin/login`

Stops automated form submission and password spraying. Free up to 1M
assessments/month. ~20 minutes.

1. Enable API: `gcloud services enable recaptchaenterprise.googleapis.com --project=medspa-494718`
2. Create a key:
   ```bash
   gcloud recaptcha keys create --display-name="aesthera-web" \
     --web --domains=medspa-web-1030670077341.us-central1.run.app,aesthera.io \
     --project=medspa-494718
   ```
3. Copy the site key and secret. Add to Cloud Run env:
   ```bash
   gcloud run services update medspa-web --region=us-central1 --project=medspa-494718 \
     --update-env-vars=NEXT_PUBLIC_RECAPTCHA_SITE_KEY=...,RECAPTCHA_SECRET=...
   ```
4. **Code change required** (Phase 2): wire the reCAPTCHA token check into
   `/api/demo` and `/api/admin/auth/password` server-side. Roughly:
   ```typescript
   const captchaToken = body.captchaToken;
   const verifyRes = await fetch(`https://recaptchaenterprise.googleapis.com/v1/projects/${PROJECT}/assessments?key=${SECRET}`, {
     method: "POST",
     body: JSON.stringify({ event: { token: captchaToken, siteKey: SITE_KEY, expectedAction: "submit_demo" } }),
   });
   if (verifyRes.score < 0.5) reject();
   ```

## 4. CMEK (Customer-Managed Encryption Keys) on Firestore

Required for the strictest HIPAA + SOC 2 postures. ~$60/mo + key operations.

1. Create a KMS keyring + key:
   ```bash
   gcloud kms keyrings create aesthera-keyring --location=us-central1 --project=medspa-494718
   gcloud kms keys create firestore-cmek --keyring=aesthera-keyring \
     --location=us-central1 --purpose=encryption --project=medspa-494718
   ```
2. CMEK on Firestore must be configured at database creation time. Our
   `(default)` database was created with Google-managed encryption. To switch:
   - Create a new Firestore database with CMEK
   - Migrate data via `gcloud firestore export` + `gcloud firestore import`
   - Switch app to point at new database
   - Delete old database
   This is a Phase 2 task — do it AFTER `aesthera.io` domain is in place and
   AFTER you have the BAA signed.

## 5. Secret rotation

`RESEND_API_KEY` and `NEXT_PUBLIC_FIREBASE_API_KEY` should be rotated every
90 days. Calendar reminder + this runbook:

```bash
# Rotate Resend
NEW_KEY=$(curl -X POST https://api.resend.com/api-keys -H "Authorization: Bearer $OLD_KEY" -d '{"name":"aesthera-prod"}' | jq -r .token)
echo -n "$NEW_KEY" | gcloud secrets versions add RESEND_API_KEY --data-file=- --project=medspa-494718
gcloud run services update medspa-web --region=us-central1 --project=medspa-494718 \
  --update-secrets=RESEND_API_KEY=RESEND_API_KEY:latest
# Then revoke the old key in Resend dashboard

# Rotate Firebase Web API key
# (Identity Platform console → Project settings → API keys → Restrict + regenerate)
```

## 6. Backup + disaster recovery

Firestore supports scheduled exports to Cloud Storage. Free at our volume.

```bash
# One-time: create a GCS bucket for exports
gcloud storage buckets create gs://aesthera-firestore-backups --location=us-central1 --project=medspa-494718

# One-shot manual export
gcloud firestore export gs://aesthera-firestore-backups/$(date +%Y%m%d)/ --project=medspa-494718

# Schedule daily exports via Cloud Scheduler (Phase 2):
gcloud scheduler jobs create http firestore-daily-backup \
  --schedule="0 6 * * *" --time-zone="America/Denver" \
  --uri="https://firestore.googleapis.com/v1/projects/medspa-494718/databases/(default):exportDocuments" \
  --http-method=POST --oauth-service-account-email=$RUNTIME_SA \
  --message-body='{"outputUriPrefix":"gs://aesthera-firestore-backups"}' \
  --project=medspa-494718
```

Retain 30 days of daily backups. Older than 30 days, lifecycle-delete.

## 7. Monitoring + alerting

Cloud Monitoring alert policies (free tier covers basic alerts):

| Alert | Condition | Where it routes |
|---|---|---|
| Failed sign-ins spike | `audit_log` count where `action='login.failure'` > 10 in 5 min | Email Cory |
| 5xx error rate | Cloud Run `serving/request_count` with response_code_class=5xx > 1% | Email Cory |
| Firestore read budget | reads > 80% of free tier daily | Email Cory |
| Cloud Run cold start latency | p99 latency > 3s for 10 min | Email Cory |

Set up via console: https://console.cloud.google.com/monitoring/alerting?project=medspa-494718

## 8. Pen-test / vulnerability scan

Before storing real PHI, run:
- **OWASP ZAP** baseline scan against the live URL
- **Google Cloud Web Security Scanner** (free in console: Security Command Center → Web Security Scanner)
- **Dependabot** (already on by default for GitHub repos — verify in repo Settings → Security)

## 9. Compliance certifications (process, not code)

These are organizational, not technical:
- **SOC 2 Type 1** — ~3-6 months prep, ~$25K+ for the audit. Required for many enterprise customers.
- **HIPAA self-attestation** — requires the BAA (step 1) + documented policies + risk assessment. No external audit needed for HIPAA but enterprise customers may want a SOC 2 + HIPAA attestation packet.

These are deferred until you have customer demand asking for them.

## 10. What's already done in the code (no action needed)

For reference — built-in:
- TOTP 2FA enrollment + sign-in challenge
- AAL2 enforcement on /admin/* (except /admin/security for self-recovery)
- Account lockout: 5 failures in 15 min → 30-minute suspension
- Per-IP + per-email rate limiting on auth endpoints
- New-IP login alert email
- Append-only audit log (Firestore security rules deny update/delete)
- HSTS, CSP, X-Frame-Options=DENY, X-Content-Type-Options, Referrer-Policy
- HttpOnly + Secure + SameSite=Lax session cookies
- Email enumeration protection (constant-time-ish responses)
- PII scrubbing in audit log writes
- Server-side input validation (zod) on every endpoint
- Secret management via Cloud Run + Secret Manager
- Firestore encryption at rest (Google-managed; CMEK in step 4 above)
- HTTPS-only (Cloud Run enforces)
