/**
 * GET /api/owner/billing/usage
 *
 * Returns the current tenant's tier limits + this-month usage + current
 * resource counts. Used by the Billing page to render usage bars.
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { limitsFor, readMonthlyUsage } from "@/lib/tier-limits";
import type { SocialConnectionDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const limits = limitsFor(ctx.tenant);
  const [
    locationsCount,
    providersCount,
    clientsCount,
    campaignsCount,
    channelsSnap,
    usage,
  ] = await Promise.all([
    tenantCol(ctx.tenant.id, "locations").where("is_active", "==", true).count().get().then((s) => s.data().count).catch(() => 0),
    tenantCol(ctx.tenant.id, "providers").where("is_active", "==", true).count().get().then((s) => s.data().count).catch(() => 0),
    tenantCol(ctx.tenant.id, "clients").count().get().then((s) => s.data().count).catch(() => 0),
    tenantCol(ctx.tenant.id, "campaigns").where("status", "==", "active").count().get().then((s) => s.data().count).catch(() => 0),
    tenantCol(ctx.tenant.id, "social_connections").where("status", "==", "connected").get().catch(() => null),
    readMonthlyUsage(ctx.tenant.id),
  ]);
  const channelsCount =
    channelsSnap?.docs.filter((d) => (d.data() as SocialConnectionDoc).status === "connected").length ?? 0;

  return NextResponse.json({
    ok: true,
    tier: ctx.tenant.subscription_tier,
    limits,
    resources: {
      locations: locationsCount,
      providers: providersCount,
      clients: clientsCount,
      campaigns: campaignsCount,
      marketing_channels: channelsCount,
    },
    usage_this_month: {
      period: usage.period,
      ai_soap_drafts: usage.ai_soap_drafts ?? 0,
      ai_marketing_emails: usage.ai_marketing_emails ?? 0,
      ai_concierge_turns: usage.ai_concierge_turns ?? 0,
      sms_sent: usage.sms_sent ?? 0,
    },
    features: limits.features,
  });
}
