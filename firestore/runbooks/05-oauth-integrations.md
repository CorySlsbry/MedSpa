# Runbook 05 — OAuth integrations (Meta, X, Google, YouTube, TikTok)

The Aesthera Settings page exposes a "Marketing channel integrations" card
where each tenant connects their social/ad platforms via OAuth. This
runbook covers what one-time developer-app setup is needed for each
platform on the Aesthera side. Per-tenant connect/disconnect is fully
self-serve once the platform's app-level credentials are in Cloud Run.

## What's already in place

- `src/lib/oauth.ts` — token encryption (AES-256-GCM) + signed-state HMAC
  + per-platform config. `OAUTH_TOKEN_KEY` lives in Secret Manager and
  is wired to Cloud Run.
- `src/lib/firestore-types.ts` — `SocialConnectionDoc` schema. Tokens
  encrypted before write. Stored at `tenants/{slug}/social_connections/{platform}`.
- API:
  - `GET /api/oauth/[platform]/start` — owner-only, signs state, redirects
  - `GET /api/oauth/[platform]/callback` — verifies state, exchanges code,
    fetches profile, encrypts + persists tokens
  - `GET /api/owner/social/connections` — Settings UI data source (never
    returns tokens)
  - `DELETE /api/owner/social/connections/[platform]` — disconnect
- UI:
  - `IntegrationsView` on /owner/settings — card grid with Connect /
    Reconnect / Disconnect actions per platform
  - `ChannelsCard` on /owner/marketing — at-a-glance status panel

## Common redirect URIs to authorize

When you create each platform's OAuth app, register these redirect URIs:

```
https://medspa-web-1030670077341.us-central1.run.app/api/oauth/google/callback
https://medspa-web-1030670077341.us-central1.run.app/api/oauth/meta/callback
https://medspa-web-1030670077341.us-central1.run.app/api/oauth/x/callback
https://medspa-web-1030670077341.us-central1.run.app/api/oauth/tiktok/callback
```

(google/callback handles both google_ads and youtube — they share an
OAuth client.)

## State as of 2026-04-30

| Platform | Dev app | Cloud Run env | Test users |
|---|---|---|---|
| Google (YouTube + Ads) | ✅ created via console | ✅ `GOOGLE_OAUTH_CLIENT_ID` env + `GOOGLE_OAUTH_CLIENT_SECRET` in Secret Manager | ✅ `cory.salisbury@gmail.com` + `person1@example.com` added |
| Meta | ⏳ Cory must create | ⏳ `META_OAUTH_CLIENT_ID/SECRET` | n/a |
| X | ⏳ Cory must create | ⏳ `X_OAUTH_CLIENT_ID/SECRET` | n/a |
| TikTok | ⏳ Cory must create | ⏳ `TIKTOK_OAUTH_CLIENT_KEY/SECRET` | n/a |

The Connect button on the Google + YouTube tiles in /owner/marketing is
LIVE — click it, sign in with the connected account, and the popup
postMessage flow returns the connection state. Other platforms show
"Setup needed" until their dev creds land.

### Note: Google Ads requires a developer token

The OAuth client is enough for the YouTube scope. Google Ads API additionally
requires a developer token from ads.google.com → Tools & settings → API
Center. That's a separate approval (often instant for basic access). Until
that token is acquired, the "Google Ads" tile will let users connect
their account but actual ads-API calls won't work yet.

## 1. Google Ads + YouTube (one OAuth client, two scopes) — DONE

1. Open https://console.cloud.google.com/apis/credentials?project=medspa-494718
2. Configure OAuth consent screen if not already:
   - User type: External
   - App name: Aesthera
   - Support email: cory.salisbury@gmail.com
   - Scopes: `openid`, `email`, `profile`, plus `youtube.readonly`,
     `youtube.upload`, `adwords` (added in step 4)
3. Credentials → "+ Create credentials" → "OAuth client ID"
   - Application type: Web application
   - Name: Aesthera Web
   - Authorized redirect URIs: `https://medspa-web-1030670077341.us-central1.run.app/api/oauth/google/callback`
4. Enable APIs:
   - YouTube Data API v3
   - Google Ads API (requires a developer token from Google Ads — apply
     at ads.google.com/aw/apicenter)
5. Set Cloud Run env:
   ```bash
   gcloud run services update medspa-web --region=us-central1 --project=medspa-494718 \
     --update-env-vars="GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com,GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-..."
   ```

## 2. Meta (Facebook + Instagram)

1. Open https://developers.facebook.com/apps → "Create App" → Business
2. Add products: Facebook Login + Instagram Graph API
3. Settings → Basic: copy App ID + App Secret
4. Facebook Login → Settings → Valid OAuth Redirect URIs:
   `https://medspa-web-1030670077341.us-central1.run.app/api/oauth/meta/callback`
5. App Review → Permissions: request `pages_manage_posts`,
   `instagram_content_publish`, `business_management`
   (publishing requires App Review approval — can take 1-3 weeks).
   Until approved, only test users can post.
6. Set Cloud Run env:
   ```bash
   gcloud run services update medspa-web --region=us-central1 --project=medspa-494718 \
     --update-env-vars="META_OAUTH_CLIENT_ID=<App ID>,META_OAUTH_CLIENT_SECRET=<App Secret>"
   ```

## 3. X (Twitter)

1. https://developer.x.com → Projects → "Create Project" → "Create App"
2. App Settings → User authentication settings → "Set up":
   - Type of App: Web App
   - App permissions: Read and Write
   - Callback URI: `https://medspa-web-1030670077341.us-central1.run.app/api/oauth/x/callback`
3. Keys and tokens → "OAuth 2.0 Client ID and Client Secret" → save them
4. Set Cloud Run env:
   ```bash
   gcloud run services update medspa-web --region=us-central1 --project=medspa-494718 \
     --update-env-vars="X_OAUTH_CLIENT_ID=<Client ID>,X_OAUTH_CLIENT_SECRET=<Client Secret>"
   ```

## 4. TikTok

1. https://developers.tiktok.com → Manage Apps → "Create an app"
2. Add products: Login Kit + Content Posting API
3. App settings → Redirect URI:
   `https://medspa-web-1030670077341.us-central1.run.app/api/oauth/tiktok/callback`
4. Scopes: user.info.basic, video.upload, video.publish
5. Submit for App Review (required before going live)
6. Set Cloud Run env:
   ```bash
   gcloud run services update medspa-web --region=us-central1 --project=medspa-494718 \
     --update-env-vars="TIKTOK_OAUTH_CLIENT_KEY=<Client Key>,TIKTOK_OAUTH_CLIENT_SECRET=<Client Secret>"
   ```

## Ops notes

- Until creds are set, the Settings UI shows each platform in
  "Setup needed" state with the relevant hint. Connect button is hidden.
- Tokens are encrypted at the application layer with AES-256-GCM, key
  in Secret Manager (`OAUTH_TOKEN_KEY`). Cloud Run runtime SA has
  `secretmanager.secretAccessor` on it.
- Refresh logic + per-platform publish APIs are NOT yet built (next
  phase). Connecting an account stores the tokens; using them comes next.
- Disconnect clears the encrypted tokens and marks status='revoked'.
  Audit log captures the connect + disconnect events (metadata only,
  never the tokens).
