/**
 * POST /api/system/cron/sms-reminders
 *
 * Cron-triggered scan: for each tenant, find appointments starting in
 * the next 22-26 hour window that have NOT had a reminder SMS sent yet,
 * and send one. The 22-26h window provides a 4-hour cushion so a
 * scheduler running every hour won't miss any (and an hourly run won't
 * double-send because we mark reminder_sms_at).
 *
 * Auth: requires CRON_SHARED_SECRET via x-aesthera-cron-key header.
 * Configure Cloud Scheduler with that header.
 *
 * SCALE: this is a brute scan-all-tenants approach. Acceptable up to
 * a few thousand tenants. Beyond that we'd shard or use Pub/Sub fan-out.
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { tenantCol } from "@/lib/tenant";
import { authorizeCron } from "@/lib/cron-auth";
import { sendSmsForTenant, buildReminderSms, isSmsConfigured } from "@/lib/sms";
import type {
  AppointmentDoc,
  ClientDoc,
  TenantDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_LOW_MIN = 22 * 60;
const WINDOW_HIGH_MIN = 26 * 60;
const ACTIVE: AppointmentDoc["status"][] = ["scheduled", "checked_in"];

export async function POST(req: Request) {
  const auth = authorizeCron(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!isSmsConfigured()) {
    return NextResponse.json({ ok: true, skipped: "sms_not_configured", sent: 0 });
  }

  const lower = new Date(Date.now() + WINDOW_LOW_MIN * 60_000);
  const upper = new Date(Date.now() + WINDOW_HIGH_MIN * 60_000);

  // Pull all active tenants. Skip cancelled / paused.
  const tenantsSnap = await db()
    .collection("tenants")
    .where("subscription_status", "in", ["active", "trialing"])
    .limit(500)
    .get();

  let sent = 0;
  let skipped = 0;
  let errored = 0;
  const tenantSummaries: Array<{ tenant: string; sent: number; errored: number }> = [];

  for (const tenantDocSnap of tenantsSnap.docs) {
    const tenant = tenantDocSnap.data() as TenantDoc;
    const slug = tenantDocSnap.id;
    let tSent = 0;
    let tErrored = 0;
    try {
      const apptSnap = await tenantCol(slug, "appointments")
        .where("starts_at", ">=", Timestamp.fromDate(lower))
        .where("starts_at", "<=", Timestamp.fromDate(upper))
        .limit(200)
        .get();

      for (const apptDocSnap of apptSnap.docs) {
        const appt = apptDocSnap.data() as AppointmentDoc;
        if (!ACTIVE.includes(appt.status)) {
          skipped++;
          continue;
        }
        if (appt.reminder_sms_at) {
          skipped++;
          continue;
        }

        // Look up client for phone + consent
        const cliSnap = await tenantCol(slug, "clients").doc(appt.client_id).get();
        if (!cliSnap.exists) {
          skipped++;
          continue;
        }
        const cli = cliSnap.data() as ClientDoc;
        if (!cli.phone || cli.sms_consent === false) {
          // mark to dedupe even when skipped — this is a reminder dedupe key
          await apptDocSnap.ref.update({
            reminder_sms_at: now(),
            updated_at: now(),
          });
          skipped++;
          continue;
        }

        const startsAt = (appt.starts_at as Timestamp).toDate();
        const result = await sendSmsForTenant(
          tenant,
          cli.phone,
          buildReminderSms({
            tenantName: tenant.name,
            serviceName: appt.service,
            startsAt,
            timezone: tenant.timezone,
          }),
        );
        if (result.ok) {
          await apptDocSnap.ref.update({
            reminder_sms_at: now(),
            updated_at: now(),
          });
          tSent++;
          sent++;
        } else {
          tErrored++;
          errored++;
          console.error("[cron-sms-reminders] send failed", slug, apptDocSnap.id, result.reason, result.error);
        }
      }
    } catch (err) {
      tErrored++;
      errored++;
      console.error("[cron-sms-reminders] tenant scan error", slug, err);
    }
    if (tSent > 0 || tErrored > 0) {
      tenantSummaries.push({ tenant: slug, sent: tSent, errored: tErrored });
    }
  }

  return NextResponse.json({
    ok: true,
    window: { from: lower.toISOString(), to: upper.toISOString() },
    tenants_scanned: tenantsSnap.size,
    sent,
    skipped,
    errored,
    tenants: tenantSummaries,
  });
}
