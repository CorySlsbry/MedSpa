# Runbook 03 — Cron jobs + integration env vars

This covers what needs to live in Cloud Run env / Secret Manager and how to
provision the Cloud Scheduler jobs that drive auto-marketing + SMS reminders.

---

## 1. Env vars (Cloud Run service: medspa-web)

Add these via the Cloud Run console or `gcloud run services update`:

### Required for cron + auto-marketing

```
CRON_SHARED_SECRET            (random ≥32-char string, e.g. `openssl rand -hex 32`)
NEXT_PUBLIC_SITE_URL          (https://medspa-web-1030670077341.us-central1.run.app)
```

### Stripe billing

```
STRIPE_SECRET_KEY             (sk_live_... or sk_test_...)
STRIPE_WEBHOOK_SECRET         (whsec_... — get this when you create the webhook in Stripe)
STRIPE_PRICE_FOUNDING_25      (price_... — for the $99/mo founding plan)
STRIPE_PRICE_BASIC            (price_... — $199/mo)
STRIPE_PRICE_GROWTH           (price_... — $399/mo)
STRIPE_PRICE_ENTERPRISE       (price_... — $899/mo)
```

After setting `STRIPE_SECRET_KEY` and the price IDs, the /owner/billing
plan picker activates.

### Twilio SMS

```
TWILIO_ACCOUNT_SID            (ACxxxxx...)
TWILIO_AUTH_TOKEN             (auth token — store in Secret Manager)
TWILIO_FROM_NUMBER            (+1 phone number purchased in Twilio Console)
```

If any of these are absent, SMS sends are silent no-ops (does not error).

### Resend webhook

```
RESEND_API_KEY                (re_... already in place)
RESEND_WEBHOOK_SECRET         (whsec_... from Resend webhook setup)
```

The webhook endpoint is: `POST /api/marketing/webhook/resend`. In the
Resend dashboard, subscribe it to:
- email.sent
- email.delivered
- email.bounced
- email.complained

---

## 2. Cloud Scheduler jobs

Two jobs, both POST to a `/api/system/cron/*` endpoint with the
`x-aesthera-cron-key` header set to `CRON_SHARED_SECRET`.

### Job: medspa-sms-reminders (hourly)

```bash
gcloud scheduler jobs create http medspa-sms-reminders \
  --location=us-central1 \
  --schedule="0 * * * *" \
  --time-zone="UTC" \
  --uri="https://medspa-web-1030670077341.us-central1.run.app/api/system/cron/sms-reminders" \
  --http-method=POST \
  --headers="x-aesthera-cron-key=<CRON_SHARED_SECRET>" \
  --attempt-deadline=540s
```

Sends 24-hour appointment reminders. Window 22-26h ahead, dedupes via
`AppointmentDoc.reminder_sms_at`. Idempotent — running twice is safe.

### Job: medspa-marketing-scan (daily 14:00 UTC = 9am MT)

```bash
gcloud scheduler jobs create http medspa-marketing-scan \
  --location=us-central1 \
  --schedule="0 14 * * *" \
  --time-zone="UTC" \
  --uri="https://medspa-web-1030670077341.us-central1.run.app/api/system/cron/marketing-scan" \
  --http-method=POST \
  --headers="x-aesthera-cron-key=<CRON_SHARED_SECRET>" \
  --attempt-deadline=540s
```

Walks every active tenant + their active CampaignDocs, finds candidates,
sends AI emails. Rate-capped at 50/campaign and 1000/run globally as a
safety valve.

### Manual trigger (for testing)

```bash
gcloud scheduler jobs run medspa-sms-reminders --location=us-central1
gcloud scheduler jobs run medspa-marketing-scan --location=us-central1
```

Or hit the endpoint directly:

```bash
curl -X POST \
  -H "x-aesthera-cron-key: $CRON_SHARED_SECRET" \
  https://medspa-web-1030670077341.us-central1.run.app/api/system/cron/marketing-scan
```

---

## 3. Stripe webhook setup (one-time)

After deploying the billing endpoints:

1. Stripe Dashboard → Developers → Webhooks → "Add endpoint"
2. URL: `https://medspa-web-1030670077341.us-central1.run.app/api/billing/webhook`
3. Subscribe to events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copy the signing secret (whsec_...) into `STRIPE_WEBHOOK_SECRET`
5. Redeploy Cloud Run so the new env var loads

Test by running `stripe trigger checkout.session.completed` against the
endpoint with the Stripe CLI.

---

## 4. Verification checklist

After all of the above:

- [ ] `gcloud scheduler jobs list --location=us-central1` shows both jobs
- [ ] Manual run of `medspa-sms-reminders` returns `{ok: true, sent: 0}`
      with no auth errors
- [ ] Stripe webhook ping (in dashboard) shows 200 from /api/billing/webhook
- [ ] `/owner/billing` shows the plan picker enabled when STRIPE_* set
- [ ] Booking via embed widget with phone → SMS arrives within 5s if
      Twilio keys set + ClientDoc has phone
