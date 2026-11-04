/**
 * GET  /api/owner/membership-plans  — list active + recently archived
 * POST /api/owner/membership-plans  — create a plan
 *
 * Tier-gated to features.memberships.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now, toDate } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { checkFeature } from "@/lib/tier-limits";
import type { MembershipPlanDoc, MembershipBillingPeriod } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  billing_period: z.enum(["monthly", "yearly"]).default("monthly"),
  price_cents: z.number().int().min(0).max(10_000_000),
  credit_per_period_cents: z.number().int().min(0).max(10_000_000).default(0),
  service_discount_pct: z.number().int().min(0).max(100).default(0),
  retail_discount_pct: z.number().int().min(0).max(100).default(0),
  perks_text: z.string().trim().max(2000).optional(),
});

export async function GET() {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const gate = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "memberships" });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message, upgrade_to: gate.upgrade_to }, { status: 402 });
  }

  const snap = await tenantCol(ctx.tenant.id, "membership_plans")
    .orderBy("name", "asc")
    .limit(100)
    .get()
    .catch(() => null);
  if (!snap) return NextResponse.json({ ok: true, plans: [] });

  const plans = snap.docs.map((d) => {
    const p = d.data() as MembershipPlanDoc;
    return {
      id: d.id,
      name: p.name,
      description: p.description,
      billing_period: p.billing_period,
      price_cents: p.price_cents,
      credit_per_period_cents: p.credit_per_period_cents,
      service_discount_pct: p.service_discount_pct,
      retail_discount_pct: p.retail_discount_pct,
      perks_text: p.perks_text,
      is_active: p.is_active,
      created_at: toDate(p.created_at),
      updated_at: toDate(p.updated_at),
    };
  });

  return NextResponse.json({ ok: true, plans });
}

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const gate = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "memberships" });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message, upgrade_to: gate.upgrade_to }, { status: 402 });
  }

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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    const id = await db().runTransaction<string>(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "membership_plans").doc();
      const doc: Omit<MembershipPlanDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        name: data.name,
        description: data.description ?? null,
        billing_period: data.billing_period as MembershipBillingPeriod,
        price_cents: data.price_cents,
        credit_per_period_cents: data.credit_per_period_cents,
        service_discount_pct: data.service_discount_pct,
        retail_discount_pct: data.retail_discount_pct,
        perks_text: data.perks_text ?? null,
        is_active: true,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(ref, doc);
      writeAuditInTx(trx, {
        action: "membership_plan.create",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "membership_plan",
        targetId: ref.id,
        after: { name: data.name, price_cents: data.price_cents },
        ip,
        userAgent: ua,
      });
      return ref.id;
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[membership-plans-post]", err);
    return NextResponse.json({ error: "Could not create plan." }, { status: 500 });
  }
}
