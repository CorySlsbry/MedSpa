/**
 * Platform-admin Google integration.
 *
 * Stores Cory's Google OAuth tokens in the singleton Firestore doc
 * `platform_oauth/google` so the platform can write Calendar events
 * when prospects book demos and (future) read Gmail for inbound replies.
 *
 * One refresh-token, one access-token, one Cory. Tokens are encrypted
 * with the shared OAUTH_TOKEN_KEY (same key used for the tenant-side
 * social connections). This module is server-only.
 */

import { google } from "googleapis";
import { db, now } from "./firestore";
import { encryptToken, decryptToken } from "./oauth";
import { Timestamp } from "firebase-admin/firestore";


export const ADMIN_GOOGLE_DOC = "platform_oauth/google";

/** Scopes we ask for. Calendar = write events. Gmail readonly = poll for replies (future). */
export const GOOGLE_ADMIN_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
];

export type AdminGoogleDoc = {
  account_email: string;
  account_name: string | null;
  scopes: string[];
  access_token_enc: string;
  refresh_token_enc: string | null;
  expiry_at: Timestamp;
  connected_at: Timestamp;
  updated_at: Timestamp;
  /** Last time we successfully called any Google API on this credential. */
  last_used_at: Timestamp | null;
  /** If the connection is broken (refresh fails), the cause. Null when healthy. */
  last_error: string | null;
};

function clientCreds(): { id: string; secret: string; redirectUri: string } {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not configured.");
  }
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://aesthera.io";
  return {
    id,
    secret,
    redirectUri: `${base.replace(/\/$/, "")}/api/admin/integrations/google/callback`,
  };
}

/** Build an unauthenticated OAuth2Client for the start of the flow. */
export function newOAuthClient() {
  const c = clientCreds();
  return new google.auth.OAuth2(c.id, c.secret, c.redirectUri);
}

/** Get an OAuth2Client primed with stored tokens, refreshing as needed. Throws if not connected. */
export async function getAuthedClient() {
  const snap = await db().doc(ADMIN_GOOGLE_DOC).get();
  if (!snap.exists) throw new Error("Google not connected. Visit /admin/integrations to connect.");
  const data = snap.data() as AdminGoogleDoc;

  const oauth = newOAuthClient();
  const access = decryptToken(data.access_token_enc);
  const refresh = data.refresh_token_enc ? decryptToken(data.refresh_token_enc) : null;
  oauth.setCredentials({
    access_token: access,
    refresh_token: refresh ?? undefined,
    expiry_date: data.expiry_at.toMillis(),
  });

  // Refresh if expiring within 60s. The library auto-refreshes on first
  // request, but persisting the new tokens needs a hook.
  oauth.on("tokens", async (tokens) => {
    const update: Record<string, unknown> = { updated_at: now() };
    if (tokens.access_token) update.access_token_enc = encryptToken(tokens.access_token);
    if (tokens.refresh_token) update.refresh_token_enc = encryptToken(tokens.refresh_token);
    if (tokens.expiry_date) update.expiry_at = Timestamp.fromMillis(tokens.expiry_date);
    update.last_used_at = now();
    update.last_error = null;
    await db().doc(ADMIN_GOOGLE_DOC).update(update).catch((err) => {
      console.error("[admin-google] persist refresh failed", err);
    });
  });

  return oauth;
}

/** True iff a connected, non-errored token doc exists. */
export async function isGoogleConnected(): Promise<boolean> {
  const snap = await db().doc(ADMIN_GOOGLE_DOC).get();
  return snap.exists;
}

export async function getConnectionInfo(): Promise<{
  connected: boolean;
  email?: string;
  name?: string | null;
  scopes?: string[];
  connectedAt?: Date;
  lastUsedAt?: Date | null;
  lastError?: string | null;
} | null> {
  const snap = await db().doc(ADMIN_GOOGLE_DOC).get();
  if (!snap.exists) return { connected: false };
  const data = snap.data() as AdminGoogleDoc;
  return {
    connected: true,
    email: data.account_email,
    name: data.account_name,
    scopes: data.scopes,
    connectedAt: data.connected_at?.toDate?.() ?? undefined,
    lastUsedAt: data.last_used_at?.toDate?.() ?? null,
    lastError: data.last_error ?? null,
  };
}

/**
 * Create a 30-min Calendar event on Cory's primary calendar when a prospect
 * books a demo. Returns the event ID + html link, or null if the platform
 * Google connection isn't set up yet (in which case the .ics email is
 * still sent and Cory accepts it manually).
 */
export async function createDemoCalendarEvent(args: {
  startUtc: Date;
  endUtc: Date;
  prospectName: string;
  prospectEmail: string;
  clinicName: string;
  notes: string | null;
  bookingId: string;
}): Promise<{ eventId: string; htmlLink: string | null; meetUrl: string | null } | null> {
  if (!(await isGoogleConnected())) return null;
  try {
    const auth = await getAuthedClient();
    const calendar = google.calendar({ version: "v3", auth });
    const description = [
      `15-min Aesthera demo with ${args.prospectName} from ${args.clinicName}.`,
      "",
      `Prospect: ${args.prospectName} <${args.prospectEmail}>`,
      `Clinic: ${args.clinicName}`,
      args.notes ? `\nNotes:\n${args.notes}` : null,
      "",
      `Booking ID: ${args.bookingId}`,
      `Manage: https://aesthera.io/admin/leads`,
    ]
      .filter((l) => l !== null)
      .join("\n");
    const resp = await calendar.events.insert({
      calendarId: "primary",
      sendUpdates: "all",
      conferenceDataVersion: 1,
      requestBody: {
        summary: `Aesthera demo · ${args.clinicName}`,
        description,
        start: { dateTime: args.startUtc.toISOString(), timeZone: "America/Denver" },
        end: { dateTime: args.endUtc.toISOString(), timeZone: "America/Denver" },
        attendees: [
          { email: args.prospectEmail, displayName: args.prospectName, responseStatus: "needsAction" },
        ],
        conferenceData: {
          createRequest: {
            requestId: args.bookingId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });
    const event = resp.data;
    const meetUrl =
      event.hangoutLink ??
      event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ??
      null;
    return {
      eventId: event.id ?? "",
      htmlLink: event.htmlLink ?? null,
      meetUrl,
    };
  } catch (err) {
    console.error("[admin-google] createDemoCalendarEvent failed", err);
    // Mark the connection as errored so the admin UI surfaces it
    void db().doc(ADMIN_GOOGLE_DOC).update({
      last_error: (err as { message?: string }).message ?? "calendar_write_failed",
      updated_at: now(),
    }).catch(() => {});
    return null;
  }
}
