/**
 * Centralized email sender + from-address constants.
 *
 * All Resend calls in the codebase should pull `from:` strings from EMAIL_FROM
 * so a future domain change (or sender-name tweak) is one edit, not fifteen.
 *
 * Domain prerequisite: aesthera.io must be added + verified as a sending
 * domain in the Resend dashboard (SPF, DKIM, DMARC TXT records added at
 * the DNS provider). Inbound forwarding (cory@, support@, etc.) is
 * independent of outbound sending — both must be configured.
 *
 * The DMARC TXT record should report to person1@example.com (already set
 * up as an inbound forward to cory.salisbury@gmail.com).
 */

const DOMAIN = process.env.AESTHERA_EMAIL_DOMAIN || "aesthera.io";

export const EMAIL_FROM = {
  // Default transactional sender for tenant-facing comms (booking confirmations,
  // owner notifications, embed booking flow). Reply-to is typically set to the
  // tenant owner_email so clients can reach the clinic directly.
  default: `Aesthera <noreply@${DOMAIN}>`,

  // Security alerts (new IP, lockout, MFA changes). Never replied to.
  security: `Aesthera Security <noreply@${DOMAIN}>`,

  // Admin auth flows (magic links into /admin, super-admin invitations).
  admin: `Aesthera Admin <noreply@${DOMAIN}>`,

  // Internal lead-capture notifications to the Aesthera team (Cory).
  leads: `Aesthera Leads <noreply@${DOMAIN}>`,

  // Owner-support / tenant invitations / onboarding (might be replied to).
  support: `Aesthera Support <support@${DOMAIN}>`,
} as const;

export const PLATFORM_SUPPORT_EMAIL = `support@${DOMAIN}`;
export const PLATFORM_DMARC_EMAIL = `dmarc@${DOMAIN}`;
export const PLATFORM_NOREPLY_EMAIL = `noreply@${DOMAIN}`;

export type SendEmailParams = {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string | string[];
  headers?: Record<string, string>;
};

export type SendEmailResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

/**
 * Best-effort Resend send. Returns `{ ok: false }` (never throws) so callers
 * can fire-and-forget without breaking the request path.
 *
 * If RESEND_API_KEY is missing, logs and returns `{ ok: false, error: "no_api_key" }`.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[email] no RESEND_API_KEY", { to: params.to, subject: params.subject });
    return { ok: false, error: "no_api_key" };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: params.from,
        to: Array.isArray(params.to) ? params.to : [params.to],
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(params.reply_to ? { reply_to: params.reply_to } : {}),
        ...(params.headers ? { headers: params.headers } : {}),
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      console.error("[email] send failed", r.status, text);
      return { ok: false, error: `${r.status} ${text}` };
    }
    const data = (await r.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id };
  } catch (err) {
    console.error("[email] send error", err);
    return { ok: false, error: String(err) };
  }
}
