# Runbook 04 — Ops state as of 2026-04-30

This is what's *actually deployed* in GCP project `medspa-494718` after
the overnight build. Use this to verify state without clicking through
the console.

## Cloud Run

- Service: `medspa-web` in `us-central1`
- Latest revision: `medspa-web-00023-stn` (deployed 2026-04-30 with
  CRON_SHARED_SECRET + NEXT_PUBLIC_SITE_URL env vars)
- Live URL: https://medspa-web-1030670077341.us-central1.run.app
- Auto-deploys on push to main via existing Cloud Build trigger

### Env vars currently set on Cloud Run

```
ADMIN_BOOTSTRAP_EMAIL          (cory.salisbury@gmail.com)
NEXT_PUBLIC_FIREBASE_API_KEY   (AIzaSy...)
NEXT_PUBLIC_SITE_URL           (https://medspa-web-1030670077341.us-central1.run.app) ← NEW 2026-04-30
RESEND_API_KEY                 (re_...)
CRON_SHARED_SECRET             (set 2026-04-30 — see Cloud Run console for value)
```

### Env vars NOT yet set (Cory must set when activating each integration)

```
STRIPE_SECRET_KEY              (sk_test_... or sk_live_...)
STRIPE_WEBHOOK_SECRET          (whsec_...)
STRIPE_PRICE_FOUNDING_25       (price_...)
STRIPE_PRICE_BASIC             (price_...)
STRIPE_PRICE_GROWTH            (price_...)
STRIPE_PRICE_ENTERPRISE        (price_...)
TWILIO_ACCOUNT_SID             (ACxxxxx...)
TWILIO_AUTH_TOKEN              (auth token)
TWILIO_FROM_NUMBER             (+1...)
RESEND_WEBHOOK_SECRET          (whsec_... from Resend webhook config)
```

## Cloud Scheduler (provisioned 2026-04-30)

```
medspa-sms-reminders   — hourly (0 * * * * UTC)
                         POST /api/system/cron/sms-reminders
                         Currently no-ops because TWILIO_* unset
                         (returns {ok:true, skipped:"sms_not_configured"})

medspa-marketing-scan  — daily 14:00 UTC = 9am MT (0 14 * * * UTC)
                         POST /api/system/cron/marketing-scan
                         Currently scans 0 active tenants (no clinics yet);
                         once a tenant has active CampaignDocs, it'll fire.
```

Both jobs auth via `x-aesthera-cron-key` header matching CRON_SHARED_SECRET.
Tested and confirmed working post-deploy.

## Cloud Monitoring alerts (provisioned 2026-04-30)

Notification channel: email → cory.salisbury@gmail.com

```
Aesthera — Cloud Run 5xx error rate         (5xx > 5/min for 5 min)
Aesthera — Cloud Run p99 latency over 5s    (p99 > 5000ms for 10 min)
```

(Cron failure alert was attempted but the metric wasn't yet emitting at
the time of provisioning — re-attempt after first scheduler attempts log.)

## APIs enabled by this build

- cloudscheduler.googleapis.com  (newly enabled)
- monitoring.googleapis.com      (newly enabled or pre-existing)

Already enabled from earlier phases:
- aiplatform.googleapis.com (Vertex AI)
- firestore.googleapis.com
- identitytoolkit.googleapis.com (Identity Platform)
- run.googleapis.com
- secretmanager.googleapis.com

## Firestore security rules

`firestore/security-rules.rules` was extended for the new collections
(services, campaigns, campaign_runs). NOT yet deployed via firebase CLI
(firebase CLI not installed in this environment). Cory should run:

```bash
# Install firebase CLI if missing
npm i -g firebase-tools

# Deploy
firebase deploy --only firestore:rules,firestore:indexes \
  --project medspa-494718 \
  --config firestore/firebase.json
```

This is functionally OK because all writes go through the Admin SDK
(bypassing rules). Rules are defense-in-depth for any future client SDK
access.

## Stripe webhook

NOT yet provisioned. Cory does this when STRIPE_SECRET_KEY is set:

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://medspa-web-1030670077341.us-central1.run.app/api/billing/webhook`
3. Subscribe to: checkout.session.completed, customer.subscription.created,
   customer.subscription.updated, customer.subscription.deleted,
   invoice.payment_failed
4. Copy whsec_... → set STRIPE_WEBHOOK_SECRET env on Cloud Run

## Resend webhook

NOT yet provisioned. Cory does this:

1. Resend Dashboard → Webhooks → Add endpoint
2. URL: `https://medspa-web-1030670077341.us-central1.run.app/api/marketing/webhook/resend`
3. Subscribe to: email.sent, email.delivered, email.bounced, email.complained
4. Copy whsec_... → set RESEND_WEBHOOK_SECRET env on Cloud Run

## Still deferred (require Cory's personal action)

- HIPAA BAA signing (free, console click)
- Buying aesthera.io domain ($38/yr)
- CMEK on Firestore (deferred — $60/mo)
- Cloud Armor + WAF (~$5/mo, multi-step gcloud)
- reCAPTCHA Enterprise wiring (key creation + code update — code mostly
  written, just needs the key)
- SOC 2 Type 1 (process, $25K+, deferred)

## Verifying state

```bash
# Cloud Run health
gcloud run services describe medspa-web --region=us-central1 --project=medspa-494718

# Scheduler jobs
gcloud scheduler jobs list --location=us-central1 --project=medspa-494718

# Run a job manually
gcloud scheduler jobs run medspa-marketing-scan --location=us-central1 --project=medspa-494718

# Test cron endpoint directly
curl -X POST -H "x-aesthera-cron-key: <SECRET>" -H "Content-Length: 0" \
  https://medspa-web-1030670077341.us-central1.run.app/api/system/cron/marketing-scan
```
