/**
 * Cloudflare Email Worker — parses inbound mail to *@aesthera.io and:
 *   1. POSTs the parsed payload to /api/marketing/inbound/email on the
 *      medspa-web Cloud Run service so the existing Sonnet reply-drafter
 *      pipeline can process it (DND detection, OOO detection, AI draft
 *      to /admin/replies for Cory to approve).
 *   2. Forwards the original message to FORWARD_TO so the human still
 *      gets a copy in their Gmail.
 *
 * Bound via Cloudflare Email Routing → "Send to a Worker" rule on
 * (typically) person1@example.com. Configure additional addresses by
 * adding more routing rules pointing at this worker.
 *
 * Deploy:
 *   1. Install wrangler globally (or via npx)
 *   2. From this directory: `wrangler login` then `wrangler deploy`
 *   3. `wrangler secret put WEBHOOK_SECRET`  — paste the value of
 *      Secret Manager's INBOUND_EMAIL_SECRET (Cloud Run already mounts it)
 *   4. Cloudflare dashboard → Email → Routing → add a rule:
 *      person1@example.com → Worker → aesthera-inbound-email
 *
 * Why a Worker (not Resend Inbound or SendGrid Parse): you keep
 * Cloudflare Email Routing for forwarding (it owns MX), and the Worker
 * is the one place that can BOTH parse-and-webhook AND forward to
 * Gmail in the same hop. Free-tier Cloudflare Workers handles this.
 */

import PostalMime from "postal-mime";

export default {
  /**
   * Cloudflare Email Worker entry point. `message.raw` is a
   * ReadableStream<Uint8Array> of the raw RFC822 source. PostalMime
   * accepts streams directly.
   */
  async email(message, env, ctx) {
    let parsed;
    try {
      parsed = await PostalMime.parse(message.raw);
    } catch (err) {
      console.error("[inbound-worker] parse failed", err);
      // Don't hard-fail — still forward to Gmail so the human sees it
      await safeForward(message, env);
      return;
    }

    const fromAddr = parsed.from?.address ?? message.from ?? "";
    const fromName = parsed.from?.name ?? "";
    const fromHeader = fromName ? `${fromName} <${fromAddr}>` : fromAddr;

    const payload = {
      to: Array.isArray(parsed.to) && parsed.to.length > 0
        ? parsed.to.map((t) => t.address).filter(Boolean)
        : [message.to],
      from: fromHeader,
      subject: parsed.subject ?? "",
      text: parsed.text ?? "",
      html: parsed.html ?? "",
      in_reply_to: getHeader(parsed, "in-reply-to"),
      references: getHeader(parsed, "references"),
    };

    const url = new URL(env.WEBHOOK_URL);
    if (env.WEBHOOK_SECRET) {
      url.searchParams.set("key", env.WEBHOOK_SECRET);
    }

    // ctx.waitUntil keeps the worker alive past the email() return so
    // the webhook POST + Gmail forward both have time to complete.
    ctx.waitUntil(
      fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(async (res) => {
          if (!res.ok) {
            console.error(
              "[inbound-worker] webhook failed",
              res.status,
              (await res.text()).slice(0, 500),
            );
          }
        })
        .catch((err) => console.error("[inbound-worker] webhook error", err)),
    );

    await safeForward(message, env);
  },
};

async function safeForward(message, env) {
  if (!env.FORWARD_TO) return;
  try {
    await message.forward(env.FORWARD_TO);
  } catch (err) {
    console.error("[inbound-worker] forward failed", err);
  }
}

function getHeader(parsed, key) {
  const lk = key.toLowerCase();
  const h = (parsed.headers ?? []).find(
    (h) => (h.key ?? "").toLowerCase() === lk,
  );
  return h?.value ?? null;
}
