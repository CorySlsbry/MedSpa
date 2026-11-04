/**
 * POST /api/system/cron/marketing-scan
 *
 * Cloud Scheduler invokes this (recommended cadence: every 6h or daily
 * at the tenant's morning hour). Per active tenant, per active campaign:
 *   - Step 0: find trigger candidates, respect cooldown, send.
 *   - Step k≥1: find clients who got step k-1 ~delay_days ago and have
 *     not yet received step k. Send.
 *
 * Auth: x-aesthera-cron-key === CRON_SHARED_SECRET.
 *
 * Cost ceiling per run is bounded by HARD_LIMIT_PER_CAMPAIGN per step
 * and HARD_LIMIT_TOTAL globally. Beyond those caps the run stops and
 * the next scheduler tick picks up where it left off (because we only
 * skip clients with an existing run for the same step).
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";
import { tenantCol } from "@/lib/tenant";
import { authorizeCron } from "@/lib/cron-auth";
import {
  findMarketingCandidates,
  clientsRecentlyMessaged,
  sendMarketingForClient,
  type MarketingCandidate,
} from "@/lib/marketing";
import { checkMonthlyUsage, bumpMonthlyUsage } from "@/lib/tier-limits";
import type {
  CampaignDoc,
  CampaignRunDoc,
  ClientDoc,
  TenantDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HARD_LIMIT_PER_CAMPAIGN = 50;
const HARD_LIMIT_TOTAL = 1000;
const DAY = 24 * 60 * 60 * 1000;
const STEP_WINDOW_HOURS = 36; // bracket around delay_days to catch a client once

export async function POST(req: Request) {
  const auth = authorizeCron(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  const tenantsSnap = await db()
    .collection("tenants")
    .where("subscription_status", "in", ["active", "trialing"])
    .limit(500)
    .get();

  let totalSent = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const summary: Array<{
    tenant: string;
    campaign: string;
    step: number;
    sent: number;
    failed: number;
    skipped: number;
  }> = [];

  outer: for (const tdSnap of tenantsSnap.docs) {
    const tenant = tdSnap.data() as TenantDoc;
    const slug = tdSnap.id;
    const campaignsSnap = await tenantCol(slug, "campaigns")
      .where("status", "==", "active")
      .limit(50)
      .get()
      .catch(() => null);
    if (!campaignsSnap || campaignsSnap.empty) continue;

    // Tier quota — skip the whole tenant if they've hit their monthly cap
    const quota = await checkMonthlyUsage({
      tenantId: slug,
      tier: tenant.subscription_tier,
      field: "ai_marketing_emails",
    });
    if (!quota.ok) {
      console.log(`[cron-marketing-scan] tenant ${slug} over quota — skipping`);
      continue;
    }

    for (const cdSnap of campaignsSnap.docs) {
      const campaign = cdSnap.data() as CampaignDoc;
      const campaignId = cdSnap.id;
      if (campaign.channel !== "email") continue; // SMS marketing not in this cron yet

      const steps = campaign.steps ?? [];

      // ── Step 0: trigger entry ────────────────────────────────────────────
      const stepZero = await runStepZero({
        slug,
        tenant,
        campaign,
        campaignId,
        baseUrl,
        budgetRemaining: HARD_LIMIT_TOTAL - (totalSent + totalFailed),
      });
      totalSent += stepZero.sent;
      totalFailed += stepZero.failed;
      totalSkipped += stepZero.skipped;
      summary.push({ tenant: slug, campaign: campaignId, step: 0, ...stepZero });
      if (stepZero.sent > 0) {
        void bumpMonthlyUsage({ tenantId: slug, field: "ai_marketing_emails", by: stepZero.sent }).catch(
          (err) => console.error("[cron-marketing-scan] usage bump (step0)", slug, err),
        );
      }
      if (totalSent + totalFailed >= HARD_LIMIT_TOTAL) {
        console.warn("[cron-marketing-scan] global cap reached after step 0");
        break outer;
      }

      // ── Steps 1..N: drip continuation ────────────────────────────────────
      for (let k = 1; k <= steps.length; k++) {
        const step = steps[k - 1]; // steps[0] applies between step 0 → step 1
        const stepResult = await runStepK({
          slug,
          tenant,
          campaign,
          campaignId,
          baseUrl,
          stepIndex: k,
          delayDays: step.delay_days,
          briefAddendum: step.brief_addendum,
          ctaOverride: step.call_to_action,
          budgetRemaining: HARD_LIMIT_TOTAL - (totalSent + totalFailed),
        });
        totalSent += stepResult.sent;
        totalFailed += stepResult.failed;
        totalSkipped += stepResult.skipped;
        summary.push({ tenant: slug, campaign: campaignId, step: k, ...stepResult });
        if (stepResult.sent > 0) {
          void bumpMonthlyUsage({
            tenantId: slug,
            field: "ai_marketing_emails",
            by: stepResult.sent,
          }).catch((err) => console.error("[cron-marketing-scan] usage bump (drip)", slug, err));
        }
        if (totalSent + totalFailed >= HARD_LIMIT_TOTAL) {
          console.warn("[cron-marketing-scan] global cap reached mid-drip");
          break outer;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    tenants_scanned: tenantsSnap.size,
    sent: totalSent,
    failed: totalFailed,
    skipped: totalSkipped,
    runs: summary,
  });
}

async function runStepZero(args: {
  slug: string;
  tenant: TenantDoc;
  campaign: CampaignDoc;
  campaignId: string;
  baseUrl: string;
  budgetRemaining: number;
}): Promise<{ sent: number; failed: number; skipped: number }> {
  let candidates: MarketingCandidate[];
  try {
    candidates = await findMarketingCandidates(args.slug, args.campaign.trigger);
  } catch (err) {
    console.error("[cron-marketing-scan] step0 candidates", args.slug, args.campaignId, err);
    return { sent: 0, failed: 0, skipped: 0 };
  }
  const recently = await clientsRecentlyMessaged(
    args.slug,
    args.campaign.trigger,
    args.campaign.cooldown_days,
  );
  const eligible = candidates
    .filter((c) => c.data.email_consent !== false)
    .filter((c) => !recently.has(c.id))
    .slice(0, Math.min(HARD_LIMIT_PER_CAMPAIGN, args.budgetRemaining));

  let sent = 0;
  let failed = 0;
  let skipped = candidates.length - eligible.length;

  for (const cand of eligible) {
    const result = await sendMarketingForClient({
      tenantId: args.slug,
      tenantName: args.tenant.name,
      ownerEmail: args.tenant.owner_email,
      bookingUrl: `${args.baseUrl}/embed/${args.slug}/book`,
      brief: args.campaign.brief,
      callToAction: args.campaign.call_to_action,
      trigger: args.campaign.trigger,
      campaignId: args.campaignId,
      candidate: cand,
      dryRun: false,
      sentByUid: null,
      sentByEmail: null,
      stepIndex: 0,
    });
    if (result.status === "sent") sent++;
    else if (result.status === "failed") failed++;
    else skipped++;
  }
  return { sent, failed, skipped };
}

async function runStepK(args: {
  slug: string;
  tenant: TenantDoc;
  campaign: CampaignDoc;
  campaignId: string;
  baseUrl: string;
  stepIndex: number;
  delayDays: number;
  briefAddendum: string | null;
  ctaOverride: string | null;
  budgetRemaining: number;
}): Promise<{ sent: number; failed: number; skipped: number }> {
  // Window: prior step run was created delay_days ago (± STEP_WINDOW_HOURS)
  const target = Date.now() - args.delayDays * DAY;
  const lo = new Date(target - (STEP_WINDOW_HOURS * 60 * 60 * 1000) / 2);
  const hi = new Date(target + (STEP_WINDOW_HOURS * 60 * 60 * 1000) / 2);

  // Find prior-step runs in window
  const priorSnap = await tenantCol(args.slug, "campaign_runs")
    .where("campaign_id", "==", args.campaignId)
    .where("created_at", ">=", Timestamp.fromDate(lo))
    .where("created_at", "<=", Timestamp.fromDate(hi))
    .limit(500)
    .get()
    .catch(() => null);
  if (!priorSnap || priorSnap.empty) return { sent: 0, failed: 0, skipped: 0 };

  const priorClients: { clientId: string; status: string }[] = [];
  for (const d of priorSnap.docs) {
    const r = d.data() as CampaignRunDoc;
    const stepIdx = r.step_index ?? 0;
    if (stepIdx !== args.stepIndex - 1) continue;
    priorClients.push({ clientId: r.client_id, status: r.status });
  }

  if (priorClients.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  // Filter out anyone who already received this step
  const alreadyAtStepSnap = await tenantCol(args.slug, "campaign_runs")
    .where("campaign_id", "==", args.campaignId)
    .limit(2000)
    .get()
    .catch(() => null);
  const alreadyAtStep = new Set<string>();
  if (alreadyAtStepSnap) {
    for (const d of alreadyAtStepSnap.docs) {
      const r = d.data() as CampaignRunDoc;
      if ((r.step_index ?? 0) === args.stepIndex) alreadyAtStep.add(r.client_id);
    }
  }

  const candidates = priorClients
    .filter((c) => !alreadyAtStep.has(c.clientId))
    // Skip dripping to clients whose prior step bounced/failed
    .filter((c) => c.status !== "bounced" && c.status !== "failed" && c.status !== "skipped_consent")
    .slice(0, Math.min(HARD_LIMIT_PER_CAMPAIGN, args.budgetRemaining));

  let sent = 0;
  let failed = 0;
  let skipped = priorClients.length - candidates.length;

  // Compose per-step brief
  const composedBrief = args.briefAddendum
    ? `${args.campaign.brief}\n\nStep ${args.stepIndex} addendum: ${args.briefAddendum}`
    : `${args.campaign.brief}\n\n(This is step ${args.stepIndex} of a multi-step sequence — keep continuity with the earlier message.)`;
  const composedCta = args.ctaOverride ?? args.campaign.call_to_action;

  for (const c of candidates) {
    // Resolve client doc
    const cliSnap = await tenantCol(args.slug, "clients").doc(c.clientId).get();
    if (!cliSnap.exists) {
      skipped++;
      continue;
    }
    const cli = cliSnap.data() as ClientDoc;
    if (cli.email_consent === false) {
      skipped++;
      continue;
    }
    const result = await sendMarketingForClient({
      tenantId: args.slug,
      tenantName: args.tenant.name,
      ownerEmail: args.tenant.owner_email,
      bookingUrl: `${args.baseUrl}/embed/${args.slug}/book`,
      brief: composedBrief,
      callToAction: composedCta,
      trigger: args.campaign.trigger,
      campaignId: args.campaignId,
      candidate: { id: c.clientId, data: cli, lastVisit: null, lastService: null },
      dryRun: false,
      sentByUid: null,
      sentByEmail: null,
      stepIndex: args.stepIndex,
    });
    if (result.status === "sent") sent++;
    else if (result.status === "failed") failed++;
    else skipped++;
  }

  return { sent, failed, skipped };
}
