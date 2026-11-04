/**
 * Twilio SMS wrapper — server-side only.
 *
 * Sends SMS via Twilio REST. No SDK to keep deps small. Env-gated:
 * if TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER are unset, sendSms()
 * is a no-op (returns ok:false with reason "not_configured") so local
 * dev and test environments don't blow up.
 *
 * SECURITY: Twilio auth is HTTP Basic — keys go in env / Secret Manager.
 *
 * COMPLIANCE: callers MUST verify recipient consent before invoking this
 * for marketing-style SMS. For transactional SMS (appointment confirmation,
 * reminder) implied consent applies, but we still respect ClientDoc.sms_consent
 * for any clinic that wants to opt clients out.
 */

export type SmsResult =
  | { ok: true; sid: string; to: string }
  | { ok: false; reason: "not_configured" | "validation" | "send_failed"; error?: string };

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER,
  );
}

/**
 * Normalize a US-phone-ish input to E.164. Accepts:
 *   - "+15551234567"  → unchanged
 *   - "15551234567"   → "+15551234567"
 *   - "5551234567"    → "+15551234567"
 *   - "(555) 123-4567" → "+15551234567"
 * Returns null if it can't make sense of the input.
 *
 * Real i18n would use a library — for the launch this is acceptable.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    return digits.length >= 10 ? digits : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * Validate a Twilio request signature using the configured AUTH_TOKEN.
 * Twilio's signature is HMAC-SHA1 over (URL + sorted-form-params),
 * base64-encoded, sent in the X-Twilio-Signature header.
 *
 * Per Twilio docs, the URL should be the FULL public URL of the webhook
 * (including query string) — NOT the local Cloud Run URL if the webhook
 * sits behind a domain alias. Use process.env.TWILIO_WEBHOOK_URL_OVERRIDE
 * to force a specific URL (set this when running behind a custom domain).
 */
export async function validateTwilioSignature(
  req: Request,
  rawBody: string,
  authTokenOverride?: string,
): Promise<boolean> {
  const token = authTokenOverride || process.env.TWILIO_AUTH_TOKEN;
  const sig = req.headers.get("x-twilio-signature");
  if (!token || !sig) return false;
  const url =
    process.env.TWILIO_WEBHOOK_URL_OVERRIDE ||
    `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}${new URL(req.url).pathname}`;
  // Parse form-urlencoded body
  const params = new URLSearchParams(rawBody);
  const sortedKeys = Array.from(params.keys()).sort();
  let buf = url;
  for (const k of sortedKeys) {
    buf += k + (params.get(k) ?? "");
  }
  const crypto = await import("node:crypto");
  const expected = crypto.createHmac("sha1", token).update(buf).digest("base64");
  // constant-time compare
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Detect STOP/START keywords. Twilio AUTO-handles STOP for compliance
 * (subsequent sends are blocked at carrier level), but we should mirror
 * the state in ClientDoc.sms_consent so our marketing engine respects it.
 */
export function isOptOutKeyword(body: string): boolean {
  const m = body.trim().toUpperCase();
  return ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(m);
}

export function isOptInKeyword(body: string): boolean {
  const m = body.trim().toUpperCase();
  return ["START", "YES", "UNSTOP"].includes(m);
}

export type SmsCreds = {
  /** Subaccount SID (ACxxxx) — falls back to master if null. */
  accountSid?: string | null;
  /** Subaccount auth token — falls back to master if null. */
  authToken?: string | null;
};

/**
 * Send an SMS via Twilio. Returns a structured result; does NOT throw on
 * Twilio API errors so callers can decide whether to surface failures.
 *
 * If `creds` is provided (tenant subaccount), the API call uses that
 * subaccount's auth_token. Otherwise falls back to the platform-wide
 * TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN.
 *
 * If `fromOverride` is provided, uses that number; otherwise falls back
 * to TWILIO_FROM_NUMBER.
 */
export async function sendSms(
  to: string,
  body: string,
  fromOverride?: string,
  creds?: SmsCreds,
): Promise<SmsResult> {
  if (!isSmsConfigured() && !creds?.accountSid) {
    return { ok: false, reason: "not_configured" };
  }
  const normalized = normalizePhone(to);
  if (!normalized) {
    return { ok: false, reason: "validation", error: "Could not parse phone." };
  }
  if (!body || body.length > 1500) {
    return { ok: false, reason: "validation", error: "SMS body must be 1..1500 chars." };
  }

  const sid = creds?.accountSid || process.env.TWILIO_ACCOUNT_SID!;
  const token = creds?.authToken || process.env.TWILIO_AUTH_TOKEN!;
  const from = fromOverride || process.env.TWILIO_FROM_NUMBER!;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams({ To: normalized, From: from, Body: body });
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, reason: "send_failed", error: text.slice(0, 300) };
    }
    const data = (await res.json()) as { sid?: string };
    return { ok: true, sid: data.sid ?? "unknown", to: normalized };
  } catch (err) {
    return { ok: false, reason: "send_failed", error: (err as Error).message };
  }
}

/**
 * Resolve tenant SMS creds (subaccount if provisioned, else master) and
 * the From number, then send. This is the right entry point for all
 * tenant-context SMS sending so each tenant's billing + A2P brand is
 * isolated correctly.
 */
export async function sendSmsForTenant(
  tenant: {
    twilio_phone_number?: string | null;
    twilio_subaccount_sid?: string | null;
    twilio_subaccount_auth_token_enc?: string | null;
  },
  to: string,
  body: string,
): Promise<SmsResult> {
  let creds: SmsCreds | undefined;
  if (tenant.twilio_subaccount_sid && tenant.twilio_subaccount_auth_token_enc) {
    try {
      const { decryptToken } = await import("./oauth");
      creds = {
        accountSid: tenant.twilio_subaccount_sid,
        authToken: decryptToken(tenant.twilio_subaccount_auth_token_enc),
      };
    } catch (err) {
      console.error("[sendSmsForTenant] decrypt", err);
      return { ok: false, reason: "send_failed", error: "Could not decrypt subaccount token." };
    }
  }
  return sendSms(to, body, tenant.twilio_phone_number || undefined, creds);
}

// ─── Twilio subaccount provisioning (Option C) ────────────────────────────────

/**
 * Create a Twilio subaccount under the platform's master account. The
 * subaccount is a fully-isolated billing + resource container with its
 * own SID + auth_token. Returns both so we can persist them on the tenant.
 *
 * Master credentials come from process.env.TWILIO_ACCOUNT_SID +
 * TWILIO_AUTH_TOKEN. The master account pays for the subaccount's usage.
 */
export async function createTwilioSubaccount(
  friendlyName: string,
): Promise<{ sid: string; auth_token: string }> {
  const masterSid = process.env.TWILIO_ACCOUNT_SID;
  const masterToken = process.env.TWILIO_AUTH_TOKEN;
  if (!masterSid || !masterToken) {
    throw new Error("Twilio master credentials are not configured.");
  }
  const auth = Buffer.from(`${masterSid}:${masterToken}`).toString("base64");
  const res = await fetch("https://api.twilio.com/2010-04-01/Accounts.json", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ FriendlyName: friendlyName }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio subaccount create failed: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { sid?: string; auth_token?: string };
  if (!data.sid || !data.auth_token) {
    throw new Error("Twilio subaccount response missing sid/auth_token.");
  }
  return { sid: data.sid, auth_token: data.auth_token };
}

/**
 * Search Twilio for an available US local number, optionally matching
 * a preferred area code. Returns the first match's E.164 phone number
 * (not yet purchased).
 */
export async function findAvailableNumber(
  subaccountSid: string,
  subaccountToken: string,
  areaCode?: string,
): Promise<string> {
  const auth = Buffer.from(`${subaccountSid}:${subaccountToken}`).toString("base64");
  const params = new URLSearchParams({
    SmsEnabled: "true",
    VoiceEnabled: "true",
    Limit: "1",
  });
  if (areaCode) params.set("AreaCode", areaCode);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${subaccountSid}/AvailablePhoneNumbers/US/Local.json?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio number search failed: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    available_phone_numbers?: { phone_number?: string }[];
  };
  const num = data.available_phone_numbers?.[0]?.phone_number;
  if (!num) {
    throw new Error(`No available local numbers${areaCode ? ` in area code ${areaCode}` : ""}.`);
  }
  return num;
}

/**
 * Purchase a phone number for a subaccount. Returns the bought number's
 * E.164. Configures SmsUrl to point at our inbound webhook so Twilio
 * forwards inbound texts to the right tenant.
 */
export async function purchaseNumber(
  subaccountSid: string,
  subaccountToken: string,
  phoneNumberE164: string,
  inboundWebhookUrl: string,
  friendlyName: string,
): Promise<{ sid: string; phone_number: string }> {
  const auth = Buffer.from(`${subaccountSid}:${subaccountToken}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${subaccountSid}/IncomingPhoneNumbers.json`;
  const body = new URLSearchParams({
    PhoneNumber: phoneNumberE164,
    SmsUrl: inboundWebhookUrl,
    SmsMethod: "POST",
    FriendlyName: friendlyName,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio number purchase failed: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { sid?: string; phone_number?: string };
  if (!data.sid || !data.phone_number) {
    throw new Error("Twilio number purchase response missing fields.");
  }
  return { sid: data.sid, phone_number: data.phone_number };
}

/**
 * Format a clean appointment confirmation SMS body. Keeps under 320 chars
 * to fit two SMS segments, with branding and a clear identifier.
 */
export function buildConfirmationSms({
  tenantName,
  serviceName,
  providerName,
  startsAt,
  timezone,
}: {
  tenantName: string;
  serviceName: string;
  providerName: string;
  startsAt: Date;
  timezone: string;
}): string {
  const when = startsAt.toLocaleString("en-US", {
    timeZone: timezone || "America/Denver",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${tenantName}: You're booked for ${serviceName} with ${providerName} on ${when}. Reply STOP to opt out.`;
}

export function buildReminderSms({
  tenantName,
  serviceName,
  startsAt,
  timezone,
}: {
  tenantName: string;
  serviceName: string;
  startsAt: Date;
  timezone: string;
}): string {
  const when = startsAt.toLocaleString("en-US", {
    timeZone: timezone || "America/Denver",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Reminder: ${tenantName} ${serviceName} is ${when}. See you then! Reply STOP to opt out.`;
}
