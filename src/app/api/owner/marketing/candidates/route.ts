/**
 * POST /api/owner/marketing/candidates
 *
 * Returns the list of clients that match a trigger right now. The owner
 * can then preview + send (via /api/owner/marketing/send).
 *
 * Per-client filtering:
 *   - Skip if email_consent === false
 *   - Skip if there's a recent campaign_run for this client + trigger
 *     within the cooldown window
 *
 * Trigger semantics live in src/lib/marketing.ts; this endpoint is a
 * thin owner-facing wrapper around findMarketingCandidates() +
 * clientsRecentlyMessaged().
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { findMarketingCandidates, clientsRecentlyMessaged } from "@/lib/marketing";
import type { CampaignTriggerType } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  trigger: z.enum([
    "birthday_week",
    "post_treatment_21_day",
    "reactivation_90_day",
    "welcome_new_client",
    "upsell_post_visit",
  ]),
  cooldown_days: z.number().int().min(0).max(365).default(30),
});

const DAY = 24 * 60 * 60 * 1000;

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

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
  const { trigger, cooldown_days } = parsed.data;

  let candidates;
  try {
    candidates = await findMarketingCandidates(ctx.tenant.id, trigger as CampaignTriggerType);
  } catch (err) {
    console.error("[marketing-candidates] query failed", err);
    return NextResponse.json({ error: "Could not load candidates." }, { status: 500 });
  }

  const recentlyMessaged = await clientsRecentlyMessaged(
    ctx.tenant.id,
    trigger as CampaignTriggerType,
    cooldown_days,
  );

  const noConsent = candidates.filter((c) => c.data.email_consent === false).length;
  const cooled = candidates.filter((c) => recentlyMessaged.has(c.id)).length;
  const out = candidates
    .filter((c) => c.data.email_consent !== false)
    .filter((c) => !recentlyMessaged.has(c.id))
    .map((c) => ({
      id: c.id,
      email: c.data.email,
      full_name: c.data.full_name,
      preferred_name: c.data.preferred_name,
      tags: c.data.tags || [],
      last_service: c.lastService,
      last_visit: c.lastVisit?.toISOString() ?? null,
      days_since_last_visit: c.lastVisit
        ? Math.floor((Date.now() - c.lastVisit.getTime()) / DAY)
        : null,
    }));

  return NextResponse.json({
    ok: true,
    trigger,
    candidates: out,
    skipped: { no_consent: noConsent, cooldown: cooled },
  });
}
