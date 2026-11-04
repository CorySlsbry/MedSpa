/**
 * Translate raw error strings (from API responses, fetch failures,
 * Firestore errors, etc.) into messages a clinic owner can understand
 * AND act on.
 *
 * Two outputs per error:
 *   - `headline` — what went wrong, in plain English (≤ 10 words)
 *   - `fix` — the next step the user can take, with a destination if any
 *
 * Used by `<FriendlyErrorBanner>` for inline render. Components that
 * already have their own banner can call this directly to enrich the
 * message they show.
 */

export type FriendlyError = {
  headline: string;
  fix: string;
  /** When set, the banner can render a button linking the user there. */
  actionHref?: string;
  actionLabel?: string;
  /** Severity hint for color coding. Defaults to "warning". */
  severity?: "info" | "warning" | "error";
};

/**
 * Map a raw error (string, Error instance, or anything `String()`-able)
 * into a friendly counterpart. Pattern-matches on the error text — order
 * matters: more-specific matches go first.
 */
export function friendlyError(raw: unknown, ctx?: string): FriendlyError {
  const text = (raw instanceof Error ? raw.message : String(raw ?? "")).toLowerCase();

  // ── SMS / Twilio ───────────────────────────────────────────────────────
  if (/twilio|sms|sms_account|account_sid|messagingservice/.test(text)) {
    return {
      headline: "Your SMS line isn't connected yet",
      fix: "We provision the SMS number for you during onboarding. If you skipped that step or your number changed, you can reconnect on Settings.",
      actionHref: "/owner/settings",
      actionLabel: "Open Settings",
      severity: "warning",
    };
  }

  // ── Stripe ────────────────────────────────────────────────────────────
  if (/stripe.*not.*connected|stripe.*not.*set|connect.*account.*missing|stripe_connect.*not/.test(text)) {
    return {
      headline: "Stripe payouts aren't set up yet",
      fix: "Stripe handles payment + payouts. Setup takes ~5 minutes — you'll need your business EIN and a bank account.",
      actionHref: "/owner/billing",
      actionLabel: "Connect Stripe",
      severity: "warning",
    };
  }
  if (/stripe.*charge.*failed|payment_intent.*failed|card.*declined/.test(text)) {
    return {
      headline: "The card was declined",
      fix: "Ask the client to try a different card, or have them call their bank — most declines clear once the bank is notified.",
      severity: "error",
    };
  }

  // ── Auth / permission ─────────────────────────────────────────────────
  if (/unauthorized|not signed in|401/.test(text)) {
    return {
      headline: "You've been signed out",
      fix: "Your session expired. Sign in again to pick up where you left off.",
      actionHref: "/sign-in",
      actionLabel: "Sign in",
      severity: "warning",
    };
  }
  if (/forbidden|403|access denied|not allowed|insufficient permission/.test(text)) {
    return {
      headline: "This account can't do that",
      fix: "Only owner accounts can take this action. Have your owner sign in, or ask them to grant you owner access in Settings.",
      severity: "warning",
    };
  }
  if (/mfa.*required|aal2/.test(text)) {
    return {
      headline: "Two-factor sign-in required",
      fix: "For HIPAA, this clinic requires two-factor sign-in. We'll send you back to the sign-in screen so you can complete it.",
      actionHref: "/sign-in",
      actionLabel: "Sign in with 2FA",
      severity: "warning",
    };
  }

  // ── Tier / plan limits ────────────────────────────────────────────────
  if (/quota.*exceeded|limit.*reached|monthly.*allowance|usage.*exceeded/.test(text)) {
    return {
      headline: "You've hit a plan limit",
      fix: "You can upgrade to the next plan tier for more headroom, or wait until next month — counters reset on the 1st.",
      actionHref: "/owner/billing",
      actionLabel: "Compare plans",
      severity: "info",
    };
  }
  if (/feature.*unavailable|not available on.*plan|requires.*growth|requires.*enterprise/.test(text)) {
    return {
      headline: "This feature isn't on your current plan",
      fix: "Upgrade your subscription tier and this unlocks immediately — no data migration, no downtime.",
      actionHref: "/owner/billing",
      actionLabel: "Compare plans",
      severity: "info",
    };
  }

  // ── Network / infrastructure ──────────────────────────────────────────
  if (/network error|fetch failed|failed to fetch|networkerror|loadtimeout|ECONNRESET|ECONNREFUSED/.test(text)) {
    return {
      headline: "Couldn't reach Aesthera",
      fix: "Your internet may have hiccupped. Wait a few seconds and try again. If it persists, your wifi may be the issue.",
      severity: "warning",
    };
  }
  if (/timeout|timed out/.test(text)) {
    return {
      headline: "That took too long",
      fix: "The server is taking longer than usual. Try again in a moment — if it keeps timing out, refresh the page.",
      severity: "warning",
    };
  }

  // ── Validation ────────────────────────────────────────────────────────
  if (/invalid email|email.*invalid|not.*valid.*email/.test(text)) {
    return {
      headline: "That email address looks off",
      fix: "Double-check the spelling — typos in the domain (gmail.com vs gmial.com) are the usual culprit.",
      severity: "warning",
    };
  }
  if (/invalid phone|phone.*invalid|not.*valid.*phone/.test(text)) {
    return {
      headline: "That phone number looks off",
      fix: "We need a 10-digit US number (e.g. 801-555-0123). Make sure there are no extra spaces or characters.",
      severity: "warning",
    };
  }
  if (/required field|missing.*required|cannot be empty|cannot be blank/.test(text)) {
    return {
      headline: "Something required is missing",
      fix: "Look for a red highlight — that's the field we need filled in to save.",
      severity: "warning",
    };
  }

  // ── Firestore / DB ────────────────────────────────────────────────────
  if (/firestore.*index|requires an index|missing.*index|composite index/.test(text)) {
    return {
      headline: "We're tuning the database",
      fix: "Refresh the page in 60 seconds — a new lookup is being indexed in the background. If this keeps happening, contact support.",
      severity: "info",
    };
  }
  if (/precondition.*failed|already.*exists|duplicate.*entry/.test(text)) {
    return {
      headline: "That already exists",
      fix: "Look for it in the list above — you may have created it earlier. If you meant to update it, edit the existing record instead.",
      severity: "info",
    };
  }
  if (/not found|404/.test(text)) {
    return {
      headline: "We couldn't find that record",
      fix: "It may have been moved or deleted. Refresh the page or go back to the list.",
      severity: "warning",
    };
  }

  // ── Rate limit ────────────────────────────────────────────────────────
  if (/rate.*limit|too many.*requests|slow down|429/.test(text)) {
    return {
      headline: "Slow down — too many requests",
      fix: "Wait 30 seconds and try again. This protects your account from runaway scripts or accidental loops.",
      severity: "info",
    };
  }

  // ── Generic fallback — keep the original text but add a fix path ─────
  return {
    headline: "Something went wrong",
    fix: ctx
      ? `${ctx} couldn't complete. Try again in a moment, or refresh the page if it keeps happening.`
      : "Try again in a moment, or refresh the page if it keeps happening. If this keeps happening, your owner can email person1@example.com.",
    severity: "warning",
  };
}
