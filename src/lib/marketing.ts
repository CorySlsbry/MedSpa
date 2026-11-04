/**
 * Shared marketing engine — used by:
 *   - POST /api/owner/marketing/candidates (owner-driven candidate preview)
 *   - POST /api/owner/marketing/send (owner-driven batch send)
 *   - POST /api/system/cron/marketing-scan (Cloud Scheduler auto-trigger)
 *
 * Trigger semantics live here so all callers stay consistent.
 */

import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "./firestore";
import { tenantCol } from "./tenant";
import { generateMarketingMessage, type MarketingDraft } from "./ai";
import { PLATFORM_NOREPLY_EMAIL } from "./email";
import type {
  AppointmentDoc,
  CampaignRunDoc,
  CampaignRunStatus,
  CampaignTriggerType,
  ClientDoc,
} from "./firestore-types";

const DAY = 24 * 60 * 60 * 1000;

export type MarketingCandidate = {
  id: string;
  data: ClientDoc;
  lastVisit: Date | null;
  lastService: string | null;
};

export async function findMarketingCandidates(
  tenantId: string,
  trigger: CampaignTriggerType,
): Promise<MarketingCandidate[]> {
  if (trigger === "birthday_week") return findBirthdayCandidates(tenantId);
  if (trigger === "post_treatment_21_day") return findCompletedAppointmentCandidates(tenantId, 18, 25);
  if (trigger === "upsell_post_visit") return findCompletedAppointmentCandidates(tenantId, 3, 7);
  if (trigger === "welcome_new_client") return findFirstVisitCandidates(tenantId, 7);
  if (trigger === "reactivation_90_day") return findReactivationCandidates(tenantId, 90);
  return [];
}

async function findBirthdayCandidates(tenantId: string): Promise<MarketingCandidate[]> {
  const snap = await tenantCol(tenantId, "clients").limit(2000).get();
  const out: MarketingCandidate[] = [];
  const today = new Date();
  for (const d of snap.docs) {
    const data = d.data() as ClientDoc;
    if (!data.date_of_birth) continue;
    if (!isBirthdayWithinDays(data.date_of_birth, 7, today)) continue;
    out.push({ id: d.id, data, lastVisit: null, lastService: null });
  }
  await enrichLastVisit(tenantId, out);
  return out;
}

function isBirthdayWithinDays(dob: string, days: number, today: Date): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return false;
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (Number.isNaN(month) || Number.isNaN(day)) return false;
  const candidate = new Date(today.getFullYear(), month, day);
  if (candidate < today) candidate.setFullYear(today.getFullYear() + 1);
  const diffDays = (candidate.getTime() - today.getTime()) / DAY;
  return diffDays >= 0 && diffDays <= days;
}

async function findCompletedAppointmentCandidates(
  tenantId: string,
  fromDaysAgo: number,
  toDaysAgo: number,
): Promise<MarketingCandidate[]> {
  const start = new Date(Date.now() - toDaysAgo * DAY);
  const end = new Date(Date.now() - fromDaysAgo * DAY);
  const snap = await tenantCol(tenantId, "appointments")
    .where("status", "==", "completed")
    .where("starts_at", ">=", Timestamp.fromDate(start))
    .where("starts_at", "<=", Timestamp.fromDate(end))
    .limit(500)
    .get()
    .catch(() => null);
  if (!snap) return [];

  const byClient = new Map<string, { last: Date; service: string }>();
  for (const d of snap.docs) {
    const a = d.data() as AppointmentDoc;
    const at = (a.starts_at as Timestamp).toDate();
    const cur = byClient.get(a.client_id);
    if (!cur || at > cur.last) byClient.set(a.client_id, { last: at, service: a.service });
  }
  const out: MarketingCandidate[] = [];
  for (const [clientId, info] of byClient) {
    const cliSnap = await tenantCol(tenantId, "clients").doc(clientId).get();
    if (!cliSnap.exists) continue;
    out.push({
      id: cliSnap.id,
      data: cliSnap.data() as ClientDoc,
      lastVisit: info.last,
      lastService: info.service,
    });
  }
  return out;
}

async function findFirstVisitCandidates(
  tenantId: string,
  daysBack: number,
): Promise<MarketingCandidate[]> {
  const cutoff = new Date(Date.now() - daysBack * DAY);
  const snap = await tenantCol(tenantId, "clients")
    .where("created_at", ">=", Timestamp.fromDate(cutoff))
    .orderBy("created_at", "desc")
    .limit(200)
    .get()
    .catch(() => null);
  if (!snap) return [];
  const out: MarketingCandidate[] = [];
  for (const d of snap.docs) {
    out.push({
      id: d.id,
      data: d.data() as ClientDoc,
      lastVisit: null,
      lastService: null,
    });
  }
  await enrichLastVisit(tenantId, out);
  return out;
}

async function findReactivationCandidates(
  tenantId: string,
  days: number,
): Promise<MarketingCandidate[]> {
  const snap = await tenantCol(tenantId, "clients").limit(2000).get();
  const out: MarketingCandidate[] = [];
  for (const d of snap.docs) {
    out.push({
      id: d.id,
      data: d.data() as ClientDoc,
      lastVisit: null,
      lastService: null,
    });
  }
  await enrichLastVisit(tenantId, out);
  const cutoff = Date.now() - days * DAY;
  return out.filter((c) => c.lastVisit !== null && c.lastVisit.getTime() < cutoff);
}

async function enrichLastVisit(tenantId: string, rows: MarketingCandidate[]): Promise<void> {
  for (const r of rows) {
    if (r.lastVisit) continue;
    // "Last visit" = most recent COMPLETED appointment in the past. Future
    // scheduled visits don't count — they'd produce negative "days since"
    // values that confuse copy generation.
    const apptSnap = await tenantCol(tenantId, "appointments")
      .where("client_id", "==", r.id)
      .orderBy("starts_at", "desc")
      .limit(20)
      .get()
      .catch(() => null);
    if (apptSnap && !apptSnap.empty) {
      const nowMs = Date.now();
      for (const d of apptSnap.docs) {
        const a = d.data() as AppointmentDoc;
        if (a.status !== "completed") continue;
        const startsAt = a.starts_at ? (a.starts_at as Timestamp).toDate() : null;
        if (!startsAt || startsAt.getTime() > nowMs) continue;
        r.lastVisit = startsAt;
        r.lastService = a.service;
        break;
      }
    }
  }
}

export async function clientsRecentlyMessaged(
  tenantId: string,
  trigger: CampaignTriggerType,
  cooldownDays: number,
): Promise<Set<string>> {
  const cutoff = Date.now() - cooldownDays * DAY;
  const recentRunsSnap = await tenantCol(tenantId, "campaign_runs")
    .where("trigger", "==", trigger)
    .where("created_at", ">=", Timestamp.fromMillis(cutoff))
    .get()
    .catch(() => null);
  const set = new Set<string>();
  if (!recentRunsSnap) return set;
  for (const d of recentRunsSnap.docs) {
    const data = d.data() as CampaignRunDoc;
    if (
      data.status === "sent" ||
      data.status === "delivered" ||
      data.status === "queued" ||
      data.status === "opened" ||
      data.status === "clicked"
    ) {
      set.add(data.client_id);
    }
  }
  return set;
}

export type SendMarketingArgs = {
  tenantId: string;
  tenantName: string;
  ownerEmail: string;
  bookingUrl: string;
  brief: string;
  callToAction: string | null;
  trigger: CampaignTriggerType;
  campaignId: string; // either a CampaignDoc id or "ad_hoc"
  candidate: MarketingCandidate;
  dryRun: boolean;
  sentByUid: string | null;
  sentByEmail: string | null;
  /** Drip step index. Default 0 = single-shot or trigger entry. */
  stepIndex?: number;
};

export type SendMarketingResult = {
  client_id: string;
  client_email: string;
  status: CampaignRunStatus;
  subject: string | null;
  preview: string | null;
  error?: string;
};

export async function sendMarketingForClient(
  args: SendMarketingArgs,
): Promise<SendMarketingResult> {
  const cli = args.candidate.data;

  if (cli.email_consent === false) {
    await recordRun(args, "skipped_consent", null, "no email consent");
    return {
      client_id: args.candidate.id,
      client_email: cli.email,
      status: "skipped_consent",
      subject: null,
      preview: null,
      error: "no email consent",
    };
  }

  const daysSince = args.candidate.lastVisit
    ? Math.floor((Date.now() - args.candidate.lastVisit.getTime()) / DAY)
    : null;

  let draft: MarketingDraft;
  try {
    draft = await generateMarketingMessage({
      trigger: args.trigger,
      tenantName: args.tenantName,
      tenantBrief: args.brief,
      callToAction: args.callToAction,
      bookingUrl: args.bookingUrl,
      clientFirstName: cli.full_name.split(" ")[0] || "there",
      clientPreferredName: cli.preferred_name,
      clientTags: cli.tags || [],
      lastServiceName: args.candidate.lastService,
      daysSinceLastVisit: daysSince,
    });
  } catch (err) {
    console.error("[marketing] AI failed", args.candidate.id, err);
    await recordRun(args, "failed", null, "AI generation failed");
    return {
      client_id: args.candidate.id,
      client_email: cli.email,
      status: "failed",
      subject: null,
      preview: null,
      error: "AI generation failed",
    };
  }

  if (args.dryRun) {
    return {
      client_id: args.candidate.id,
      client_email: cli.email,
      status: "queued",
      subject: draft.subject,
      preview: draft.body_text.slice(0, 200),
    };
  }

  let sendStatus: CampaignRunStatus = "sent";
  let failureReason: string | null = null;
  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      console.log("[marketing] (no resend key) would send to", cli.email);
    } else {
      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${args.tenantName} <${PLATFORM_NOREPLY_EMAIL}>`,
          to: [cli.email],
          reply_to: args.ownerEmail,
          subject: draft.subject,
          html: appendTrackingPixel(draft.body_html, args.tenantId, args.candidate.id, args.campaignId),
          text: draft.body_text,
          headers: {
            "X-Aesthera-Tenant": args.tenantId,
            "X-Aesthera-Campaign": args.campaignId,
            "X-Aesthera-Client": args.candidate.id,
          },
        }),
      });
      if (!sendRes.ok) {
        sendStatus = "failed";
        failureReason = `Resend ${sendRes.status}`;
      }
    }
  } catch (err) {
    console.error("[marketing] resend error", err);
    sendStatus = "failed";
    failureReason = "send error";
  }

  await recordRun(args, sendStatus, draft, failureReason);
  return {
    client_id: args.candidate.id,
    client_email: cli.email,
    status: sendStatus,
    subject: draft.subject,
    preview: draft.body_text.slice(0, 200),
    error: failureReason ?? undefined,
  };
}

function appendTrackingPixel(html: string, tenantId: string, clientId: string, campaignId: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  if (!baseUrl) return html;
  const px = `${baseUrl}/api/marketing/track/open?t=${encodeURIComponent(tenantId)}&c=${encodeURIComponent(clientId)}&cmp=${encodeURIComponent(campaignId)}`;
  return `${html}<img src="${px}" alt="" width="1" height="1" style="display:none" />`;
}

async function recordRun(
  args: SendMarketingArgs,
  status: CampaignRunStatus,
  draft: MarketingDraft | null,
  failureReason: string | null,
): Promise<void> {
  try {
    const ref = tenantCol(args.tenantId, "campaign_runs").doc();
    const doc: Omit<
      CampaignRunDoc,
      "created_at" | "queued_at" | "sent_at" | "delivered_at" | "opened_at"
    > & {
      created_at: ReturnType<typeof now>;
      queued_at: ReturnType<typeof now> | null;
      sent_at: ReturnType<typeof now> | null;
      delivered_at: null;
      opened_at: null;
    } = {
      tenant_id: args.tenantId,
      campaign_id: args.campaignId,
      trigger: args.trigger,
      channel: "email",
      client_id: args.candidate.id,
      client_email: args.candidate.data.email,
      subject: draft?.subject ?? null,
      body_html: draft?.body_html ?? null,
      body_text: draft?.body_text ?? null,
      status,
      failure_reason: failureReason,
      sent_by_user_id: args.sentByUid,
      sent_by_email: args.sentByEmail,
      step_index: args.stepIndex ?? 0,
      queued_at: now(),
      sent_at: status === "sent" ? now() : null,
      delivered_at: null,
      opened_at: null,
      created_at: now(),
    };
    await db().collection(`tenants/${args.tenantId}/campaign_runs`).doc(ref.id).set(doc);
  } catch (err) {
    console.error("[marketing] recordRun failed", err);
  }
}
