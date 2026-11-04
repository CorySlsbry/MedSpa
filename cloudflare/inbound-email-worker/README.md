# Aesthera Inbound Email Worker

Parses inbound mail to `*@aesthera.io` and:
1. POSTs the parsed payload to `/api/marketing/inbound/email` on
   medspa-web (Cloud Run) so the Sonnet reply-drafter pipeline runs.
2. Forwards the original to your personal Gmail so you still see it.

Why a Cloudflare Worker (not Resend Inbound or SendGrid Parse): MX
records on `aesthera.io` already point at Cloudflare Email Routing.
A Worker is the only way to BOTH parse-and-webhook AND forward to Gmail
in the same routing hop without changing MX.

## One-time deploy

```bash
cd cloudflare/inbound-email-worker
npm install            # installs postal-mime + wrangler
npx wrangler login     # opens browser, authenticates
npx wrangler deploy    # publishes the worker
```

After deploy, set the shared webhook secret. The value is stored in
Google Secret Manager as `INBOUND_EMAIL_SECRET` and already mounted on
the Cloud Run service. Pull it once:

```bash
gcloud secrets versions access latest --secret=INBOUND_EMAIL_SECRET --project=medspa-494718
# Copy the output, then:
npx wrangler secret put WEBHOOK_SECRET
# Paste when prompted.
```

## Wire the Email Routing rule

In Cloudflare dashboard:

1. `aesthera.io` zone → **Email** → **Email Routing** → **Routes**
2. Create or edit the rule for `person1@example.com`:
   - Custom address: `person1@example.com`
   - Action: **Send to a Worker**
   - Destination: `aesthera-inbound-email`
3. Save. Send a test email to `person1@example.com`. It should:
   - Land in your Gmail (forwarded by the Worker)
   - Land in `/admin/replies` as an `awaiting_review` row with a
     Sonnet draft

You can route additional addresses (`support@`, `hello@`, etc.) to the
same Worker by adding more rules.

## Smoke-test the Cloud Run handler directly (no Cloudflare needed)

```bash
SECRET="$(gcloud secrets versions access latest --secret=INBOUND_EMAIL_SECRET --project=medspa-494718)"
curl -X POST "https://aesthera.io/api/marketing/inbound/email?key=$SECRET" \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "person1@example.com",
    "from": "Test User <test@example.com>",
    "subject": "Re: Quick question about Aesthera",
    "text": "Hey — what does the Growth tier include for inventory?",
    "in_reply_to": null,
    "references": null
  }'
```

Expected response: `{"ok": true, "action": "drafted"}` (or
`queued_no_draft` if Anthropic is rate-limiting). The row appears at
`/admin/replies`.

## Local development (optional)

```bash
npx wrangler dev
```

Sends test emails to `http://localhost:8787` per Cloudflare's local
email-worker simulator. Useful for iterating on the parse logic
before redeploying.

## Tail production logs

```bash
npx wrangler tail
```

Streams `console.log` / `console.error` from live Worker invocations.
