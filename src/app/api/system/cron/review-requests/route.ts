/**
 * POST /api/system/cron/review-requests
 *
 * Runs hourly. Finds appointments that completed 18-30 hours ago and
 * sends the client a "leave us a review" email with the tenant's
 * google_review_url. Idempotent via review_request_sent_at.
 *
 * Skip conditions:
 *  - tenant.google_review_url is null
 *  - client.email_consent === false
 *  - review_request_sent_at already set
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { tenantCol } from "@/lib/tenant";
import { authorizeCron } from "@/lib/cron-auth";
import { writeAudit } from "@/lib/audit";
import { PLATFORM_NOREPLY_EMAIL } from "@/lib/email";
import type {
  AppointmentDoc,
  ClientDoc,
  TenantDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;

export async function POST(req: Request) {
  const auth = authorizeCron(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const lower = new Date(Date.now() - 30 * HOUR);
  const upper = new Date(Date.now() - 18 * HOUR);

  const apptSnap = await db()
    .collectionGroup("appointments")
    .where("status", "==", "completed")
    .where("ends_at", ">=", Timestamp.fromDate(lower))
    .where("ends_at", "<=", Timestamp.fromDate(upper))
    .limit(500)
    .get();

  const tenantCache = new Map<string, TenantDoc>();
  let scanned = 0;
  let sent = 0;

  for (const doc of apptSnap.docs) {
    scanned++;
    const appt = doc.data() as AppointmentDoc;
    if (appt.review_request_sent_at) continue;

    let tenant = tenantCache.get(appt.tenant_id);
    if (!tenant) {
      const t = await db().collection("tenants").doc(appt.tenant_id).get();
      if (!t.exists) continue;
      tenant = t.data() as TenantDoc;
      tenantCache.set(appt.tenant_id, tenant);
    }
    if (!tenant.google_review_url) continue;

    const cliSnap = await tenantCol(appt.tenant_id, "clients").doc(appt.client_id).get();
    if (!cliSnap.exists) continue;
    const client = cliSnap.data() as ClientDoc;
    if (!client.email || client.email_consent === false) continue;

    try {
      await sendReviewEmail({ tenant, client, serviceName: appt.service });
      await doc.ref.update({
        review_request_sent_at: now(),
        updated_at: now(),
      });
      await writeAudit({
        action: "review.request_sent",
        actorEmail: null,
        targetType: "appointment",
        targetId: doc.id,
        after: { client_id: appt.client_id, service: appt.service },
      });
      sent++;
    } catch (err) {
      console.error("[review-requests]", err);
    }
  }

  return NextResponse.json({ ok: true, scanned, sent });
}

async function sendReviewEmail(args: {
  tenant: TenantDoc;
  client: ClientDoc;
  serviceName: string;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  const accent = args.tenant.primary_color ?? "#b98f42";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${args.tenant.name} <${PLATFORM_NOREPLY_EMAIL}>`,
      to: [args.client.email],
      reply_to: args.tenant.owner_email,
      subject: `${args.tenant.name} — how was your ${args.serviceName}?`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1b2636">
          <p>Hi ${args.client.full_name.split(" ")[0]},</p>
          <p>Thanks for visiting <strong>${args.tenant.name}</strong> yesterday. We hope you loved your ${args.serviceName}.</p>
          <p>If you have a moment, would you share a quick review? It helps so much, and it lets us know what's working.</p>
          <p style="margin:28px 0">
            <a href="${args.tenant.google_review_url}"
               style="display:inline-block;padding:14px 28px;background:${accent};color:#fff;
                      text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
              ★ Leave a review →
            </a>
          </p>
          <p style="color:#666;font-size:13px">
            If something didn't go right, please reply to this email instead — we'd love to make it right.
          </p>
        </div>
      `,
    }),
  });
}
