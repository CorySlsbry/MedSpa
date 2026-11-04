/**
 * POST /api/system/cron/auto-rebook
 *
 * Daily sweeper: finds completed appointments at the
 * service.recommended_rebook_days mark and emails the client a
 * "time to rebook" link. Cuts churn for cadenced services (Botox 90d,
 * HydraFacial 30d, etc.). Idempotent via rebook_prompt_sent_at.
 *
 * Strategy:
 *  - Pull completed appointments with rebook_prompt_sent_at=null in the
 *    last 200 days (cap window so the query stays cheap).
 *  - For each, look up service.recommended_rebook_days. If null, skip.
 *  - If now >= ends_at + recommended_rebook_days, send the email and
 *    flip the flag.
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { authorizeCron } from "@/lib/cron-auth";
import { tenantCol } from "@/lib/tenant";
import { PLATFORM_NOREPLY_EMAIL } from "@/lib/email";
import type {
  AppointmentDoc,
  ClientDoc,
  ServiceDoc,
  TenantDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 200;
const DAY = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const auth = authorizeCron(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const now_ms = Date.now();
  const horizon = new Date(now_ms - WINDOW_DAYS * DAY);

  let scanned = 0;
  let sent = 0;

  const apptSnap = await db()
    .collectionGroup("appointments")
    .where("status", "==", "completed")
    .where("ends_at", ">=", Timestamp.fromDate(horizon))
    .limit(2000)
    .get();

  // Cache services + tenants per tenant to avoid N+1
  const tenantCache = new Map<string, TenantDoc>();
  const serviceCache = new Map<string, ServiceDoc | null>();

  for (const doc of apptSnap.docs) {
    scanned++;
    const appt = doc.data() as AppointmentDoc;
    if (appt.rebook_prompt_sent_at) continue;
    if (!appt.tenant_id) continue;

    let tenant = tenantCache.get(appt.tenant_id);
    if (!tenant) {
      const tSnap = await db().collection("tenants").doc(appt.tenant_id).get();
      if (!tSnap.exists) continue;
      tenant = tSnap.data() as TenantDoc;
      tenantCache.set(appt.tenant_id, tenant);
    }

    const svcKey = `${appt.tenant_id}:${appt.service}`;
    let svc = serviceCache.get(svcKey);
    if (svc === undefined) {
      const svcQuery = await tenantCol(appt.tenant_id, "services")
        .where("name", "==", appt.service)
        .limit(1)
        .get();
      svc = svcQuery.empty ? null : (svcQuery.docs[0].data() as ServiceDoc);
      serviceCache.set(svcKey, svc);
    }
    if (!svc?.recommended_rebook_days) continue;

    const dueAt =
      appt.ends_at.toDate().getTime() + svc.recommended_rebook_days * DAY;
    if (now_ms < dueAt) continue;

    // Resolve client + send
    const cliSnap = await tenantCol(appt.tenant_id, "clients").doc(appt.client_id).get();
    if (!cliSnap.exists) continue;
    const client = cliSnap.data() as ClientDoc;
    if (!client.email || client.email_consent === false) continue;

    try {
      await sendRebookEmail({
        tenant,
        tenantSlug: appt.tenant_id,
        client,
        serviceName: appt.service,
        rebookDays: svc.recommended_rebook_days,
      });
      await doc.ref.update({
        rebook_prompt_sent_at: now(),
        updated_at: now(),
      });
      sent++;
    } catch (err) {
      console.error("[auto-rebook] send", err);
    }
  }

  return NextResponse.json({ ok: true, scanned, sent });
}

async function sendRebookEmail(args: {
  tenant: TenantDoc;
  tenantSlug: string;
  client: ClientDoc;
  serviceName: string;
  rebookDays: number;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://aesthera.io";
  const bookUrl = `${baseUrl}/embed/${args.tenantSlug}/book?service=${encodeURIComponent(args.serviceName)}`;
  const accent = args.tenant.primary_color ?? "#b98f42";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${args.tenant.name} <${PLATFORM_NOREPLY_EMAIL}>`,
      to: [args.client.email],
      reply_to: args.tenant.owner_email,
      subject: `${args.tenant.name} — time for your next ${args.serviceName}?`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1b2636">
          <p>Hi ${args.client.full_name.split(" ")[0]},</p>
          <p>It's been about ${args.rebookDays} days since your last <strong>${args.serviceName}</strong> at <strong>${args.tenant.name}</strong> — the perfect window for your next visit.</p>
          <p style="margin:24px 0">
            <a href="${bookUrl}"
               style="display:inline-block;padding:14px 28px;background:${accent};color:#fff;
                      text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
              Book your next visit →
            </a>
          </p>
          <p style="color:#666;font-size:13px">
            Reply to this email with any questions, or hit unsubscribe below to stop these reminders.
          </p>
        </div>
      `,
    }),
  });
}
