/**
 * GET  /api/owner/campaigns  — list this tenant's persistent campaigns
 * POST /api/owner/campaigns  — create a new persistent campaign
 *
 * Persistent campaigns are CampaignDocs at tenants/{slug}/campaigns/{id}.
 * The Cloud Scheduler /api/system/cron/marketing-scan endpoint walks
 * status='active' campaigns each run.
 *
 * Owner-only.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import type { CampaignDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StepSchema = z.object({
  delay_days: z.number().int().min(0).max(180),
  brief_addendum: z.string().trim().max(800).nullable().optional(),
  call_to_action: z.string().trim().max(120).nullable().optional(),
});

const Create = z.object({
  trigger: z.enum([
    "birthday_week",
    "post_treatment_21_day",
    "reactivation_90_day",
    "welcome_new_client",
    "upsell_post_visit",
  ]),
  channel: z.enum(["email", "sms"]).default("email"),
  name: z.string().trim().min(1).max(120),
  brief: z.string().trim().min(1).max(1000),
  call_to_action: z.string().trim().max(120).optional().nullable(),
  cooldown_days: z.number().int().min(0).max(365).default(30),
  status: z.enum(["draft", "active", "paused"]).default("active"),
  steps: z.array(StepSchema).max(10).optional(),
});

export async function GET() {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const snap = await tenantCol(ctx.tenant.id, "campaigns")
    .orderBy("created_at", "desc")
    .limit(100)
    .get()
    .catch(() => null);

  if (!snap) return NextResponse.json({ ok: true, campaigns: [] });

  const out = snap.docs.map((d) => {
    const c = d.data() as CampaignDoc;
    return {
      id: d.id,
      trigger: c.trigger,
      channel: c.channel,
      name: c.name,
      brief: c.brief,
      call_to_action: c.call_to_action,
      status: c.status,
      cooldown_days: c.cooldown_days,
      steps: c.steps ?? [],
      created_at: (c.created_at as Timestamp)?.toDate().toISOString() ?? null,
      updated_at: (c.updated_at as Timestamp)?.toDate().toISOString() ?? null,
    };
  });

  return NextResponse.json({ ok: true, campaigns: out });
}

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Create.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const ref = tenantCol(ctx.tenant.id, "campaigns").doc();
  const doc: Omit<CampaignDoc, "created_at" | "updated_at"> & {
    created_at: ReturnType<typeof now>;
    updated_at: ReturnType<typeof now>;
  } = {
    tenant_id: ctx.tenant.id,
    trigger: data.trigger,
    channel: data.channel,
    name: data.name,
    brief: data.brief,
    call_to_action: data.call_to_action ?? null,
    status: data.status,
    cooldown_days: data.cooldown_days,
    steps: (data.steps ?? []).map((s) => ({
      delay_days: s.delay_days,
      brief_addendum: s.brief_addendum ?? null,
      call_to_action: s.call_to_action ?? null,
    })),
    created_at: now(),
    updated_at: now(),
  };
  await ref.set(doc);

  await writeAudit({
    action: "admin.user_create",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "campaign",
    targetId: ref.id,
    after: { trigger: data.trigger, status: data.status, channel: data.channel },
  }).catch((err) => console.error("[campaigns] audit", err));

  return NextResponse.json({ ok: true, id: ref.id });
}
