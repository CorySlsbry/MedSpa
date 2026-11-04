/**
 * OAuth utilities for tenant-level social/ad-platform integrations.
 *
 * Tokens are encrypted at the application layer with AES-256-GCM keyed
 * by OAUTH_TOKEN_KEY (32 bytes hex). Firestore at-rest encryption is the
 * defense-in-depth layer underneath.
 *
 * State signing: the OAuth state param carries (tenant_id, platform,
 * actor_uid, nonce) signed with HMAC-SHA256 using OAUTH_TOKEN_KEY so the
 * callback can verify it didn't get tampered with.
 *
 * Server-side only — never import this from a client component.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SocialPlatform } from "./firestore-types";

function getKey(): Buffer {
  const k = process.env.OAUTH_TOKEN_KEY;
  if (!k) throw new Error("OAUTH_TOKEN_KEY env var not set.");
  if (k.length !== 64) throw new Error("OAUTH_TOKEN_KEY must be 64 hex chars (32 bytes).");
  return Buffer.from(k, "hex");
}

/** Encrypt a string with AES-256-GCM. Returns "v1:<iv>:<tag>:<ct>" all base64. */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptToken(blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Bad cipher blob.");
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Signed state for the OAuth round-trip. */
export type OAuthState = {
  tenantId: string;
  platform: SocialPlatform;
  actorUid: string;
  nonce: string;
  /** ms since epoch */
  ts: number;
};

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function signState(state: Omit<OAuthState, "nonce" | "ts">): string {
  const full: OAuthState = { ...state, nonce: randomBytes(8).toString("hex"), ts: Date.now() };
  const json = Buffer.from(JSON.stringify(full)).toString("base64url");
  const mac = createHmac("sha256", getKey()).update(json).digest("base64url");
  return `${json}.${mac}`;
}

export function verifyState(token: string): OAuthState {
  const idx = token.lastIndexOf(".");
  if (idx < 0) throw new Error("Bad state token.");
  const json = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = createHmac("sha256", getKey()).update(json).digest("base64url");
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    throw new Error("State signature mismatch.");
  }
  const state = JSON.parse(Buffer.from(json, "base64url").toString("utf8")) as OAuthState;
  if (Date.now() - state.ts > STATE_TTL_MS) throw new Error("State expired.");
  return state;
}

// ── Per-platform configs ────────────────────────────────────────────────────

export type PlatformConfig = {
  /** Whether the platform is wired up + has client creds in env. */
  configured: boolean;
  authorizeUrl: (state: string, redirectUri: string, scopes: string[]) => string;
  tokenExchangeUrl: string;
  defaultScopes: string[];
  /** What we need from the user's developer console. */
  setupHint: string;
};

function buildAuthorize(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export function platformConfig(platform: SocialPlatform): PlatformConfig {
  switch (platform) {
    case "google_ads":
    case "youtube": {
      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
      return {
        configured: Boolean(clientId && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
        authorizeUrl: (state, redirectUri, scopes) =>
          buildAuthorize("https://accounts.google.com/o/oauth2/v2/auth", {
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: scopes.join(" "),
            access_type: "offline",
            // select_account forces the chooser every time so reconnects can
            // pick a different Google account; consent forces the scope
            // confirmation so we always get a refresh_token back.
            prompt: "select_account consent",
            include_granted_scopes: "true",
            state,
          }),
        tokenExchangeUrl: "https://oauth2.googleapis.com/token",
        defaultScopes:
          platform === "youtube"
            ? [
                "https://www.googleapis.com/auth/youtube.readonly",
                "https://www.googleapis.com/auth/youtube.upload",
                "openid",
                "email",
                "profile",
              ]
            : [
                "https://www.googleapis.com/auth/adwords",
                "openid",
                "email",
                "profile",
              ],
        setupHint:
          "GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET in Cloud Run env. Create at console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0 Client (Web app). Add /api/oauth/google/callback as a redirect URI.",
      };
    }
    case "meta": {
      const clientId = process.env.META_OAUTH_CLIENT_ID || "";
      return {
        configured: Boolean(clientId && process.env.META_OAUTH_CLIENT_SECRET),
        authorizeUrl: (state, redirectUri, scopes) =>
          buildAuthorize("https://www.facebook.com/v19.0/dialog/oauth", {
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: scopes.join(","),
            state,
          }),
        tokenExchangeUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
        defaultScopes: [
          "pages_show_list",
          "pages_read_engagement",
          "pages_manage_posts",
          "instagram_basic",
          "instagram_content_publish",
          "business_management",
        ],
        setupHint:
          "META_OAUTH_CLIENT_ID + META_OAUTH_CLIENT_SECRET in Cloud Run env. Create app at developers.facebook.com → My Apps → Create App (Business). Enable Facebook Login + Instagram Graph API. Add /api/oauth/meta/callback as a redirect URI.",
      };
    }
    case "x": {
      const clientId = process.env.X_OAUTH_CLIENT_ID || "";
      return {
        configured: Boolean(clientId && process.env.X_OAUTH_CLIENT_SECRET),
        authorizeUrl: (state, redirectUri, scopes) =>
          buildAuthorize("https://twitter.com/i/oauth2/authorize", {
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: scopes.join(" "),
            code_challenge: "challenge",
            code_challenge_method: "plain",
            state,
          }),
        tokenExchangeUrl: "https://api.twitter.com/2/oauth2/token",
        defaultScopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
        setupHint:
          "X_OAUTH_CLIENT_ID + X_OAUTH_CLIENT_SECRET in Cloud Run env. Create app at developer.x.com → Projects → Apps → User Authentication Settings (OAuth 2.0). Add /api/oauth/x/callback as a callback URI.",
      };
    }
    case "tiktok": {
      const clientId = process.env.TIKTOK_OAUTH_CLIENT_KEY || "";
      return {
        configured: Boolean(clientId && process.env.TIKTOK_OAUTH_CLIENT_SECRET),
        authorizeUrl: (state, redirectUri, scopes) =>
          buildAuthorize("https://www.tiktok.com/v2/auth/authorize/", {
            client_key: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: scopes.join(","),
            state,
          }),
        tokenExchangeUrl: "https://open.tiktokapis.com/v2/oauth/token/",
        defaultScopes: [
          "user.info.basic",
          "video.upload",
          "video.publish",
        ],
        setupHint:
          "TIKTOK_OAUTH_CLIENT_KEY + TIKTOK_OAUTH_CLIENT_SECRET in Cloud Run env. Create app at developers.tiktok.com → Manage Apps → Login Kit + Content Posting API. Add /api/oauth/tiktok/callback as a redirect URI.",
      };
    }
  }
}

/** Display metadata for the Settings UI. */
export const PLATFORM_DISPLAY: Record<
  SocialPlatform,
  { name: string; description: string; icon: string; brandColor: string }
> = {
  meta: {
    name: "Meta (Facebook + Instagram)",
    description: "Publish posts to a Facebook Page + Instagram Business profile.",
    icon: "M",
    brandColor: "#1877F2",
  },
  x: {
    name: "X (Twitter)",
    description: "Post to a connected X account from the marketing engine.",
    icon: "X",
    brandColor: "#000000",
  },
  google_ads: {
    name: "Google Ads",
    description: "Connect your Google Ads account for campaign attribution + ROAS.",
    icon: "G",
    brandColor: "#4285F4",
  },
  youtube: {
    name: "YouTube",
    description: "Upload short-form clips + manage your channel.",
    icon: "Y",
    brandColor: "#FF0000",
  },
  tiktok: {
    name: "TikTok",
    description: "Publish short-form video to your TikTok account.",
    icon: "T",
    brandColor: "#000000",
  },
};
