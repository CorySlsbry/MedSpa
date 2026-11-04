/**
 * POST /api/owner/marketing/send
 *
 * Owner-driven batch send. Generate AI personalized copy + send via Resend
 * + record campaign_runs for each client_id.
 *
 * Body: {
 *   trigger: CampaignTriggerType,
 *   client_ids: string[],         // up to 50 per call
 *   brief: string,                 // owner's intent + tone description
 *   call_to_action: string | null,
 *   dry_run: boolean,              // true = generate but don't send
 * }
 *
 * Per-owner rate limit: 5 batches/hour to keep AI costs predictable.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendMarketingForClient, type SendMarketingResult } from "@/lib/marketing";
import { checkMonthlyUsage, bumpMonthlyUsage } from "@/lib/tier-limits";
import type {
  AppointmentDoc,
  CampaignTriggerType,
  ClientDoc,
} from "@/lib/firestore-types";
import { Timestamp } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 50;

const Body = z.object({
  trigger: z.enum([
    "birthday_week",
    "post_treatment_21_day",
    "reactivation_90_day",
    "welcome_new_client",
    "upsell_post_visit",
  ]),
  client_ids: z.array(z.string().trim().min(1)).min(1).max(MAX_BATCH),
  brief: z.string().trim().min(1).max(1000),
  call_to_action: z.string().trim().max(120).optional().nullable(),
  dry_run: z.boolean().default(false),
});

const RATE = { capacity: 5, windowMs: 60 * 60 * 1000 };

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const rl = checkRateLimit(`marketing-send:${ctx.user.firebaseUid}`, RATE);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many marketing batches this hour. Try again later." },
      { status: 429 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  const bookingUrl = `${baseUrl}/embed/${ctx.tenant.id}/book`;

  // Tier quota — only enforced for non-dry runs
  if (!data.dry_run) {
    const quota = await checkMonthlyUsage({
      tenantId: ctx.tenant.id,
      tier: ctx.tenant.subscription_tier,
      field: "ai_marketing_emails",
      headroom: data.client_ids.length,
    });
    if (!quota.ok) {
      return NextResponse.json(
        { error: quota.message, upgrade_to: quota.upgrade_to },
        { status: 402 },
      );
    }
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  const results: SendMarketingResult[] = [];
  for (const clientId of data.client_ids) {
    const cliSnap = await tenantCol(ctx.tenant.id, "clients").doc(clientId).get();
    if (!cliSnap.exists) {
      results.push({
        client_id: clientId,
        client_email: "",
        status: "failed",
        subject: null,
        preview: null,
        error: "Client not found",
      });
      continue;
    }
    const cliData = cliSnap.data() as ClientDoc;

    // Pull last appt for context
    const apptSnap = await tenantCol(ctx.tenant.id, "appointments")
      .where("client_id", "==", clientId)
      .orderBy("starts_at", "desc")
      .limit(1)
      .get()
      .catch(() => null);
    let lastService: string | null = null;
    let lastVisit: Date | null = null;
    if (apptSnap && !apptSnap.empty) {
      const a = apptSnap.docs[0].data() as AppointmentDoc;
      lastService = a.service;
      lastVisit = a.starts_at ? (a.starts_at as Timestamp).toDate() : null;
    }

    const result = await sendMarketingForClient({
      tenantId: ctx.tenant.id,
      tenantName: ctx.tenant.name,
      ownerEmail: ctx.tenant.owner_email,
      bookingUrl,
      brief: data.brief,
      callToAction: data.call_to_action ?? null,
      trigger: data.trigger as CampaignTriggerType,
      campaignId: "ad_hoc",
      candidate: { id: clientId, data: cliData, lastVisit, lastService },
      dryRun: data.dry_run,
      sentByUid: ctx.user.firebaseUid,
      sentByEmail: ctx.user.email,
    });
    results.push(result);
  }

  // Bump usage by the number of successful sends (skip dry runs)
  if (!data.dry_run) {
    const sentCount = results.filter((r) => r.status === "sent").length;
    if (sentCount > 0) {
      void bumpMonthlyUsage({
        tenantId: ctx.tenant.id,
        field: "ai_marketing_emails",
        by: sentCount,
      }).catch((err) => console.error("[marketing-send] usage bump failed", err));
    }
  }

  try {
    await writeAudit({
      action: "admin.user_create",
      actorEmail: ctx.user.email,
      actorUserId: ctx.user.firebaseUid,
      targetType: data.dry_run ? "marketing.preview" : "marketing.send",
      after: {
        trigger: data.trigger,
        attempted: data.client_ids.length,
        sent: results.filter((r) => r.status === "sent").length,
        failed: results.filter((r) => r.status === "failed").length,
        dry_run: data.dry_run,
      },
      ip,
      userAgent: ua,
    });
  } catch (err) {
    console.error("[marketing-send] audit", err);
  }

  return NextResponse.json({ ok: true, runs: results });
}
