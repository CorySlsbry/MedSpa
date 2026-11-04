/**
 * GET  /api/owner/client-memberships  — list with optional ?status= filter
 * POST /api/owner/client-memberships  — enroll a client in a plan
 *
 * Enrollment snapshots the plan's price/billing-period into the membership
 * doc so future plan edits don't retroactively change member terms.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now, toDate } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { checkFeature } from "@/lib/tier-limits";
import type {
  ClientDoc,
  ClientMembershipDoc,
  MembershipBillingPeriod,
  MembershipPlanDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  client_id: z.string().min(1),
  plan_id: z.string().min(1),
  start_date: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).optional(),
  auto_bill: z.boolean().optional(),
});

function periodEnd(start: Date, billing: MembershipBillingPeriod): Date {
  const d = new Date(start);
  if (billing === "yearly") {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

export async function GET(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const gate = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "memberships" });
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message, upgrade_to: gate.upgrade_to }, { status: 402 });
  }

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");

  const baseQ = tenantCol(ctx.tenant.id, "client_memberships");
  const q: FirebaseFirestore.Query = statusFilter
    ? baseQ.where("status", "==", statusFilter).orderBy("started_at", "desc").limit(500)
    : baseQ.orderBy("started_at", "desc").limit(500);
  const snap = await q.get().catch(() => null);
  if (!snap) return NextResponse.json({ ok: true, memberships: [] });

  // Resolve client names in one pass
  const clientIds = new Set<string>();
  for (const d of snap.docs) {
    const m = d.data() as ClientMembershipDoc;
    clientIds.add(m.client_id);
  }
  const clientMap = new Map<string, string>();
  if (clientIds.size > 0) {
    const cliSnaps = await Promise.all(
      [...clientIds].map((cid) =>
        tenantCol(ctx.tenant.id, "clients").doc(cid).get().catch(() => null),
      ),
    );
    for (const cs of cliSnaps) {
      if (cs && cs.exists) {
        const c = cs.data() as ClientDoc;
        clientMap.set(cs.id, c.full_name);
      }
    }
  }

  const memberships = snap.docs.map((d) => {
    const m = d.data() as ClientMembershipDoc;
    return {
      id: d.id,
      client_id: m.client_id,
      client_name: clientMap.get(m.client_id) ?? null,
      plan_id: m.plan_id,
      plan_name_snapshot: m.plan_name_snapshot,
      billing_period_snapshot: m.billing_period_snapshot,
      price_cents_snapshot: m.price_cents_snapshot,
      status: m.status,
      started_at: toDate(m.started_at),
      current_period_start: toDate(m.current_period_start),
      current_period_end: toDate(m.current_period_end),
      next_renewal_at: toDate(m.next_renewal_at),
      canceled_at: toDate(m.canceled_at),
      paused_until: toDate(m.paused_until),
      balance_cents: m.balance_cents,
      notes: m.notes,
    };
  });

  return NextResponse.json({ ok: true, memberships });
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
  const start = data.start_date ? new Date(data.start_date) : new Date();

  try {
    const id = await db().runTransaction<string>(async (trx) => {
      const planRef = tenantCol(ctx.tenant.id, "membership_plans").doc(data.plan_id);
      const cliRef = tenantCol(ctx.tenant.id, "clients").doc(data.client_id);
      const [planSnap, cliSnap] = await Promise.all([trx.get(planRef), trx.get(cliRef)]);
      if (!planSnap.exists) throw new Error("Plan not found.");
      if (!cliSnap.exists) throw new Error("Client not found.");
      const plan = planSnap.data() as MembershipPlanDoc;
      if (!plan.is_active) throw new Error("Plan is archived.");

      const periodEndDate = periodEnd(start, plan.billing_period);
      const ref = tenantCol(ctx.tenant.id, "client_memberships").doc();
      const doc: Omit<ClientMembershipDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        client_id: data.client_id,
        plan_id: data.plan_id,
        plan_name_snapshot: plan.name,
        billing_period_snapshot: plan.billing_period,
        price_cents_snapshot: plan.price_cents,
        status: "active",
        started_at: Timestamp.fromDate(start),
        current_period_start: Timestamp.fromDate(start),
        current_period_end: Timestamp.fromDate(periodEndDate),
        next_renewal_at: Timestamp.fromDate(periodEndDate),
        canceled_at: null,
        paused_until: null,
        balance_cents: plan.credit_per_period_cents,
        stripe_subscription_id: null,
        auto_bill: data.auto_bill ?? false,
        stripe_customer_id: null,
        stripe_payment_method_id: null,
        card_last4: null,
        card_brand: null,
        failed_payment_count: 0,
        last_payment_attempt_at: null,
        last_payment_error: null,
        notes: data.notes ?? null,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(ref, doc);

      // Initial credit movement (the welcome credit)
      if (plan.credit_per_period_cents > 0) {
        const chargeRef = ref.collection("charges").doc();
        trx.create(chargeRef, {
          tenant_id: ctx.tenant.id,
          membership_id: ref.id,
          client_id: data.client_id,
          type: "credit_added",
          amount_cents: plan.credit_per_period_cents,
          balance_after_cents: plan.credit_per_period_cents,
          reason: "Initial period credit",
          ref_type: "manual",
          ref_id: null,
          actor_user_id: ctx.user.firebaseUid,
          actor_email: ctx.user.email,
          created_at: now(),
        });
      }

      writeAuditInTx(trx, {
        action: "membership.create",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "client_membership",
        targetId: ref.id,
        after: { client_id: data.client_id, plan_id: data.plan_id, plan_name: plan.name },
        ip,
        userAgent: ua,
      });

      return ref.id;
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg.includes("not found") || msg.includes("archived") ? 400 : 500 },
    );
  }
}

