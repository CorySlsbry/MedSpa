# External API tokens — what to provision so Claude can drive your dashboards

These are the tokens that, if pasted into Google Secret Manager, let
Claude (or any future Aesthera automation) take real actions on your
behalf without asking you to click through the vendor's web UI.

**You only have to do this once.** I read from Secret Manager just-in-time
when I need to act, never log the values, and Cloud Run mounts them only
where they're actually used.

---

## Already provisioned

| Secret | Used for | Status |
|---|---|---|
| `RESEND_API_KEY` | Sending email + querying Resend domains/events | ✅ Live |
| `RESEND_WEBHOOK_SECRET` | Verifying inbound webhook from Resend | ✅ Live |
| `INBOUND_EMAIL_SECRET` | Cloudflare Email Worker → /api/marketing/inbound/email auth | ✅ Live |
| `JARVIS_API_KEY` | Service-to-service auth for Jarvis lead pushes | ✅ Live |
| `ANTHROPIC_API_KEY` | Claude Sonnet for reply drafts + AI assistant | ✅ Live |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firestore + Auth admin SDK | ✅ Live |
| `OAUTH_TOKEN_KEY` | AES-256-GCM key for encrypting tenant OAuth refresh tokens | ✅ Live |

---

## Worth adding for vendor automation

### 1. `CLOUDFLARE_API_TOKEN` — manage Email Routing rules from the platform

**What it unlocks:**
- Auto-create Email Routing rules for new addresses
- Toggle rules on/off without you logging in
- Read the current rule set so /admin can show "this address forwards
  to → these destinations"
- Future: provision DNS records (e.g. for new tenants getting their
  own subdomain)

**How to create:**
1. https://dash.cloudflare.com/profile/api-tokens → **Create Token**
2. Use **Custom token** template
3. Permissions:
   - **Zone** → **Email Routing Rules** → **Edit**
   - **Zone** → **Email Routing Settings** → **Edit**
   - (Optional, for future DNS work) **Zone** → **DNS** → **Edit**
4. Zone Resources: **Include** → **Specific zone** → `aesthera.io`
5. (Optional) IP filter: leave blank
6. **Create Token** → copy the value (one chance)
7. Paste into Secret Manager:
   ```bash
   gcloud secrets create CLOUDFLARE_API_TOKEN --project=medspa-494718 --replication-policy=automatic
   printf 'PASTE_TOKEN_HERE' | gcloud secrets versions add CLOUDFLARE_API_TOKEN --project=medspa-494718 --data-file=-
   gcloud run services update medspa-web --region=us-central1 --project=medspa-494718 \
     --update-secrets CLOUDFLARE_API_TOKEN=CLOUDFLARE_API_TOKEN:latest
   ```

**How to revoke if anything goes wrong:** Cloudflare dashboard →
API Tokens → Roll or Delete on that token. No code change needed
on our side.

### 2. `CLOUDFLARE_ZONE_ID` — paired with the token above

Find on the Cloudflare dashboard → `aesthera.io` → **Overview** sidebar
("Zone ID"). Lower-sensitivity — it's effectively a public identifier
for your zone.

```bash
gcloud secrets create CLOUDFLARE_ZONE_ID --project=medspa-494718 --replication-policy=automatic
printf 'PASTE_ZONE_ID_HERE' | gcloud secrets versions add CLOUDFLARE_ZONE_ID --project=medspa-494718 --data-file=-
gcloud run services update medspa-web --region=us-central1 --project=medspa-494718 \
  --update-secrets CLOUDFLARE_ZONE_ID=CLOUDFLARE_ZONE_ID:latest
```

---

## Optional but useful

### `GMAIL_OAUTH_REFRESH_TOKEN` — read your Gmail inbox programmatically

Not needed for sending — Gmail's "Send mail as" already works via
Resend SMTP. Where this becomes valuable: if you want me to *read*
your inbox to auto-categorize or summarize. Privacy footprint is
high — defer until there's a clear use case.

### `GOOGLE_WORKSPACE_CUSTOMER_ID`

Only relevant if you upgrade to Workspace later for native
@aesthera.io mailboxes. Skip for now.

---

## Tokens to AVOID for now

- **Cloudflare Global API Key** (vs. scoped token above) — full
  account access. Use the scoped token instead.
- **Resend account-level keys** — domain-scoped is enough for our use.
- **Stripe restricted keys with full write** — current Stripe Connect
  flow only needs platform-key scope; nothing here changes that.

---

## What I'll do once `CLOUDFLARE_API_TOKEN` lands

When that token is in Secret Manager, I can:

1. Add the `support@`, `hello@`, `cory@`, `replies@` Email Routing
   rules from one prompt instead of you clicking through the
   Cloudflare UI four times.
2. Programmatically point `person1@example.com` at the
   `aesthera-inbound-email` Worker as part of the deploy script.
3. Audit "what addresses forward where" without you opening the
   dashboard — useful for diagnosing forwarding issues mid-campaign.

I'll write a `/admin/integrations` panel for it so the rules are
visible + editable from your console, not just a script.
