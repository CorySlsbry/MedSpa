/**
 * POST /api/marketing/webhook/resend
 *
 * Resend webhook receiver. Updates the relevant campaign_run with
 * delivery/bounce/complaint status. Resend signs webhooks with Svix
 * (svix-id, svix-timestamp, svix-signature) — we verify if the secret
 * is configured.
 *
 * Events we care about:
 *   - email.sent
 *   - email.delivered      → status = "delivered", delivered_at = ts
 *   - email.bounced        → status = "bounced", failure_reason = bounce
 *   - email.complained     → suppress: set client.email_consent = false
 *
 * Resend's `headers` field on send becomes `tags` on the event — we
 * stuff the X-Aesthera-Tenant / -Client / -Campaign there to find the
 * matching campaign_run row.
 */

import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHmac, timingSafeEqual } from "node:crypto";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { flagContactDnd } from "@/lib/dnd";
import type { CampaignRunDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResendEvent = {
  type: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    subject?: string;
    headers?: Record<string, string>;
    /** Resend ships tags either as Record<string,string> (legacy) or as
     * Array<{name,value}> (new send-time tags). We normalize below. */
    tags?: Record<string, string> | Array<{ name?: string; value?: string }>;
    bounce?: { type?: string; subType?: string; description?: string };
  };
  created_at?: string;
};

export async function POST(req: Request) {
  const body = await req.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET || "";

  if (secret) {
    const ok = await verifySvixSignature(req, body, secret);
    if (!ok) {
      console.warn("[resend-webhook] signature verification failed");
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
  } else {
    // Without a secret, accept the call but log loudly.
    console.warn("[resend-webhook] no RESEND_WEBHOOK_SECRET set — running unverified");
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Normalize tags to a flat Record<string,string>. New-style send tags ship
  // as an array of {name,value}; legacy headers ship as Record<string,string>.
  const tags: Record<string, string> = { ...(event.data?.headers || {}) };
  const rawTags = event.data?.tags;
  if (Array.isArray(rawTags)) {
    for (const t of rawTags) {
      if (t?.name && typeof t.value === "string") tags[t.name] = t.value;
    }
  } else if (rawTags && typeof rawTags === "object") {
    Object.assign(tags, rawTags as Record<string, string>);
  }

  // Platform email tracking — workflow_step + info_nurture sends are tagged
  // with scheduled_email_id at send time, which lets us update the row
  // directly without a query. Run this BEFORE the tenant marketing branch
  // so platform tracking always lands.
  const scheduledEmailId = tags["scheduled_email_id"];
  if (scheduledEmailId) {
    await applyPlatformTrackingEvent(scheduledEmailId, event).catch((err) => {
      console.error("[resend-webhook] platform tracking update failed", err);
    });
    // Don't return — we still want bounce/complaint to flag DND below.
  }

  const tenantId = tags["X-Aesthera-Tenant"] || tags["x-aesthera-tenant"];
  const clientId = tags["X-Aesthera-Client"] || tags["x-aesthera-client"];
  const campaignId = tags["X-Aesthera-Campaign"] || tags["x-aesthera-campaign"];

  // Platform-level handling FIRST: bounce or complaint on ANY email with a
  // recipient address — flag the platform contact + cancel queued sends.
  // Done before the tenant-marketing branch so inbound-nurture leads (which
  // have no tenant tag) still get protected.
  const recipientEmail = (() => {
    const to = event.data?.to;
    if (Array.isArray(to)) return to[0];
    if (typeof to === "string") return to;
    return null;
  })();
  if (recipientEmail) {
    if (event.type === "email.bounced") {
      const subType = event.data?.bounce?.subType?.toLowerCase() || "";
      const reason = subType === "general" || subType.includes("hard") ? "bounce_hard" : "bounce_soft";
      void flagContactDnd(recipientEmail, reason, event.data?.bounce?.description).catch((err) =>
        console.error("[resend-webhook] platform DND flag failed", err),
      );
    } else if (event.type === "email.complained") {
      void flagContactDnd(recipientEmail, "complained").catch((err) =>
        console.error("[resend-webhook] platform DND flag failed", err),
      );
    }
  }

  if (!tenantId || !clientId) {
    // Not one of our tenant marketing emails — platform-level tracking +
    // DND already applied above if relevant. Ack and exit.
    return NextResponse.json({
      ok: true,
      ignored: "no_tenant_tags",
      platform_tracked: Boolean(scheduledEmailId),
    });
  }

  const matching = await tenantCol(tenantId, "campaign_runs")
    .where("client_id", "==", clientId)
    .orderBy("created_at", "desc")
    .limit(5)
    .get()
    .catch(() => null);
  if (!matching || matching.empty) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const target = campaignId
    ? matching.docs.find((d) => (d.data() as CampaignRunDoc).campaign_id === campaignId)
    : matching.docs[0];
  if (!target) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const update: Record<string, unknown> = {};
  switch (event.type) {
    case "email.sent":
      update.status = "sent";
      update.sent_at = Timestamp.now();
      break;
    case "email.delivered":
      update.status = "delivered";
      update.delivered_at = Timestamp.now();
      break;
    case "email.bounced":
      update.status = "bounced";
      update.failure_reason = event.data?.bounce?.description || "bounced";
      break;
    case "email.complained":
      update.status = "bounced";
      update.failure_reason = "complained";
      // Suppress future marketing — flip email_consent on the client
      void suppressClient(tenantId, clientId).catch((err) =>
        console.error("[resend-webhook] suppress failed", err),
      );
      break;
    default:
      // Unknown event — ack
      return NextResponse.json({ ok: true });
  }
  await target.ref.update(update);
  return NextResponse.json({ ok: true });
}

/**
 * Apply a Resend webhook event to the matching scheduled_emails row.
 * Counts opens/clicks idempotently (Resend can re-fire) using
 * FieldValue.increment, and stamps last_*_at timestamps.
 */
async function applyPlatformTrackingEvent(
  scheduledEmailId: string,
  event: ResendEvent,
): Promise<void> {
  const ref = db().collection("scheduled_emails").doc(scheduledEmailId);
  const update: Record<string, unknown> = {};
  switch (event.type) {
    case "email.delivered":
      update.delivered_at = Timestamp.now();
      break;
    case "email.opened":
      update.opens_count = FieldValue.increment(1);
      update.last_opened_at = Timestamp.now();
      break;
    case "email.clicked":
      update.clicks_count = FieldValue.increment(1);
      update.last_clicked_at = Timestamp.now();
      break;
    case "email.bounced":
      update.bounced_at = Timestamp.now();
      update.bounce_reason = event.data?.bounce?.description ?? "bounced";
      break;
    case "email.complained":
      update.complained_at = Timestamp.now();
      break;
    default:
      return; // unknown event — no-op
  }
  await ref.update(update).catch((err) => {
    // Doc may have been deleted or never existed (e.g., test send) — log
    // and move on. Never throw out of a webhook handler.
    console.warn(
      `[resend-webhook] scheduled_emails/${scheduledEmailId} update failed: ${String(err)}`,
    );
  });
}

async function suppressClient(tenantId: string, clientId: string): Promise<void> {
  await tenantCol(tenantId, "clients").doc(clientId).update({
    email_consent: false,
    updated_at: now(),
  });
  await writeAudit({
    action: "admin.user_suspend",
    targetType: "client.email_suppressed",
    targetId: clientId,
    after: { tenant_id: tenantId, reason: "complained" },
  });
}

async function verifySvixSignature(req: Request, body: string, secret: string): Promise<boolean> {
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sig = req.headers.get("svix-signature");
  if (!id || !ts || !sig) return false;

  // Svix signing format: signature header looks like "v1,base64sig v1,base64sig2"
  // Compute expected: HMAC-SHA256 of `${id}.${ts}.${body}` with the secret bytes
  const secretBytes = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret);
  const toSign = `${id}.${ts}.${body}`;
  const computed = createHmac("sha256", secretBytes).update(toSign).digest("base64");
  const expected = `v1,${computed}`;

  // Header may contain multiple space-separated signatures — match any
  const sigs = sig.split(" ");
  for (const s of sigs) {
    try {
      if (s.length !== expected.length) continue;
      if (timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return true;
    } catch {
      continue;
    }
  }
  return false;
}
