/**
 * Security utilities — account lockout, new-IP detection, alert emails.
 *
 * All state lives in Firestore so it's consistent across Cloud Run instances
 * (the in-memory rate limiter is per-instance only).
 */

import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db, now, toDate } from "./firestore";
import { EMAIL_FROM } from "./email";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

// ── Account lockout ──────────────────────────────────────────────────────────

export type LockoutState =
  | { locked: false }
  | { locked: true; until: Date };

/**
 * Returns the current lockout state for a Firebase UID. If the user doc
 * doesn't exist, returns unlocked (we'll create the doc on first successful
 * sign-in).
 */
export async function checkLockout(firebaseUid: string): Promise<LockoutState> {
  try {
    const snap = await db().collection("users").doc(firebaseUid).get();
    const data = snap.data() as
      | { locked_until?: Timestamp | null }
      | undefined;
    const until = toDate(data?.locked_until ?? null);
    if (until && until.getTime() > Date.now()) {
      return { locked: true, until };
    }
    return { locked: false };
  } catch (err) {
    console.error("[security] checkLockout failed, fail-open", err);
    return { locked: false };
  }
}

/**
 * Bump the failure counter on a user doc. If failures >= threshold within
 * the window, set locked_until. Idempotent + race-safe via a transaction.
 */
export async function recordFailedLogin(firebaseUid: string): Promise<{
  failedCount: number;
  lockedUntil: Date | null;
}> {
  const ref = db().collection("users").doc(firebaseUid);
  return db().runTransaction(async (trx) => {
    const snap = await trx.get(ref);
    const data = (snap.data() ?? {}) as {
      failed_login_count?: number;
      last_failed_login_at?: Timestamp | null;
    };
    const lastFailedAt = toDate(data.last_failed_login_at ?? null);
    const withinWindow =
      !!lastFailedAt && Date.now() - lastFailedAt.getTime() < LOCKOUT_WINDOW_MS;
    const newCount = withinWindow ? (data.failed_login_count ?? 0) + 1 : 1;

    let lockedUntil: Date | null = null;
    const updates: Record<string, unknown> = {
      failed_login_count: newCount,
      last_failed_login_at: now(),
      updated_at: now(),
    };
    if (newCount >= LOCKOUT_THRESHOLD) {
      lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      updates.locked_until = Timestamp.fromDate(lockedUntil);
      updates.status = "suspended";
    }
    trx.set(ref, updates, { merge: true });
    return { failedCount: newCount, lockedUntil };
  });
}

/**
 * Reset failure counters after a successful sign-in.
 */
export async function recordSuccessfulLogin(firebaseUid: string): Promise<void> {
  try {
    await db()
      .collection("users")
      .doc(firebaseUid)
      .set(
        {
          failed_login_count: 0,
          last_failed_login_at: null,
          locked_until: null,
          status: "active",
          last_seen_at: now(),
          updated_at: now(),
        },
        { merge: true },
      );
  } catch (err) {
    console.error("[security] recordSuccessfulLogin failed", err);
  }
}

// ── New-IP detection ─────────────────────────────────────────────────────────

/**
 * Returns true if this email has never had a successful sign-in from this IP.
 * Rough check — pulls last 50 successful attempts. For our volume that's
 * comprehensive; for higher volume we'd add an explicit known_ips list.
 */
export async function isUnseenIp(email: string, ip: string | null): Promise<boolean> {
  if (!ip) return false;
  try {
    const snap = await db()
      .collection("login_attempts")
      .where("email", "==", email)
      .where("succeeded", "==", true)
      .orderBy("created_at", "desc")
      .limit(50)
      .get();
    return !snap.docs.some((d) => (d.data().ip as string | null) === ip);
  } catch (err) {
    // Composite index missing on first run — assume seen to avoid spam alerts
    console.error("[security] isUnseenIp query failed", err);
    return false;
  }
}

/**
 * Send a security alert email via Resend. Best-effort.
 */
export async function sendSecurityAlert(
  toEmail: string,
  subject: string,
  bodyHtml: string,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[security] alert (no resend key)", { toEmail, subject });
    return;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM.security,
        to: [toEmail],
        subject,
        html: bodyHtml,
      }),
    });
    if (!r.ok) {
      console.error("[security] alert send failed", r.status, await r.text());
    }
  } catch (err) {
    console.error("[security] alert send error", err);
  }
}

export function newIpAlertHtml(args: {
  email: string;
  ip: string;
  ua: string | null;
  when: Date;
  signinUrl: string;
}): string {
  const uaShort = args.ua ? escapeHtml(args.ua.slice(0, 200)) : "—";
  return `
    <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px">
      <h2 style="color:#1b2636">New sign-in from an unrecognized location</h2>
      <p>An <strong>${escapeHtml(args.email)}</strong> sign-in just succeeded from an IP you haven't used before:</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 12px 6px 0;color:#666">IP</td><td style="font-family:monospace">${escapeHtml(args.ip)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">When</td><td>${args.when.toUTCString()}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Device</td><td style="font-size:12px;color:#888">${uaShort}</td></tr>
      </table>
      <p style="margin-top:24px"><strong>If this was you</strong>, no action needed — we just wanted to flag it.</p>
      <p><strong>If this wasn't you</strong>: change your password immediately, then sign in and rotate your authenticator at <a href="${args.signinUrl}/admin/security">${args.signinUrl}/admin/security</a>.</p>
      <hr style="border:none;border-top:1px solid #eee;margin-top:24px"/>
      <p style="font-size:12px;color:#888">Aesthera CRM security alert · automated · do not reply</p>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
