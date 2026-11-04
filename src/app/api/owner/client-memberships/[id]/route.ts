/**
 * POST /api/owner/client-memberships/[id]
 *   body { action: "renew" | "cancel" | "pause" | "resume" | "credit" |
 *          "redeem", ... }
 *
 * Actions:
 *   - renew: rolls current_period_start/end forward, adds plan credit,
 *     logs a "renewal" charge.
 *   - cancel: status=canceled, canceled_at=now (membership stays usable
 *     through current_period_end).
 *   - pause: status=paused, paused_until=date.
 *   - resume: status=active, paused_until=null, period start = now.
 *   - credit: adds amount_cents to balance.
 *   - redeem: deducts amount_cents from balance (allowed to go negative).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { checkFeature } from "@/lib/tier-limits";
import type {
  ClientMembershipDoc,
  MembershipBillingPeriod,
  MembershipChargeType,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("renew") }),
  z.object({
    action: z.literal("cancel"),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("pause"),
    until: z
      .string()
      .datetime()
      .refine((d) => new Date(d).getTime() > Date.now(), {
        message: "Pause-until must be in the future.",
      }),
  }),
  z.object({ action: z.literal("resume") }),
  z.object({
    action: z.literal("credit"),
    amount_cents: z.number().int().positive(),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("redeem"),
    amount_cents: z.number().int().positive(),
    reason: z.string().trim().max(500).optional(),
    appointment_id: z.string().optional(),
  }),
]);

function periodEnd(start: Date, billing: MembershipBillingPeriod): Date {
  const d = new Date(start);
  if (billing === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export async function POST(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const gate = checkFeature({ tier: ctx.tenant.subscription_tier, feature: "memberships" });
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: 402 });

  const { id } = await rctx.params;
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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    const result = await db().runTransaction<{
      status: string;
      balance_cents: number;
      next_renewal_at: string | null;
    }>(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "client_memberships").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Not found.");
      const m = snap.data() as ClientMembershipDoc;

      // Read plan only when we need its renewal credit (for renew action)
      let renewCreditCents = 0;
      if (parsed.data.action === "renew") {
        const planRef = tenantCol(ctx.tenant.id, "membership_plans").doc(m.plan_id);
        const planSnap = await trx.get(planRef);
        if (planSnap.exists) {
          const plan = planSnap.data() as { credit_per_period_cents?: number };
          renewCreditCents = plan.credit_per_period_cents ?? 0;
        }
      }

      // ─── all reads done — writes follow ──────────────────────────────────
      let newBalance = m.balance_cents;
      let newStatus = m.status;
      let newPeriodEnd = m.current_period_end;
      let newPeriodStart = m.current_period_start;
      let newNextRenewal = m.next_renewal_at;
      let newCanceledAt = m.canceled_at;
      let newPausedUntil = m.paused_until;

      const chargeType: MembershipChargeType | null = (() => {
        switch (parsed.data.action) {
          case "renew": return "renewal";
          case "credit": return "credit_added";
          case "redeem": return "credit_redeemed";
          default: return null;
        }
      })();

      switch (parsed.data.action) {
        case "renew": {
          if (m.status === "canceled") throw new Error("Cannot renew a canceled membership.");
          const start = m.current_period_end.toDate();
          const end = periodEnd(start, m.billing_period_snapshot);
          newPeriodStart = Timestamp.fromDate(start);
          newPeriodEnd = Timestamp.fromDate(end);
          newNextRenewal = Timestamp.fromDate(end);
          newBalance += renewCreditCents;
          newStatus = "active";
          break;
        }
        case "cancel": {
          newStatus = "canceled";
          newCanceledAt = now() as unknown as Timestamp;
          break;
        }
        case "pause": {
          newStatus = "paused";
          newPausedUntil = Timestamp.fromDate(new Date(parsed.data.until));
          break;
        }
        case "resume": {
          newStatus = "active";
          newPausedUntil = null;
          break;
        }
        case "credit": {
          newBalance += parsed.data.amount_cents;
          break;
        }
        case "redeem": {
          newBalance -= parsed.data.amount_cents;
          break;
        }
      }

      trx.update(ref, {
        status: newStatus,
        current_period_start: newPeriodStart,
        current_period_end: newPeriodEnd,
        next_renewal_at: newNextRenewal,
        canceled_at: newCanceledAt,
        paused_until: newPausedUntil,
        balance_cents: newBalance,
        updated_at: now(),
      });

      if (chargeType) {
        const chargeRef = ref.collection("charges").doc();
        const delta =
          parsed.data.action === "renew"
            ? renewCreditCents
            : parsed.data.action === "credit"
            ? parsed.data.amount_cents
            : parsed.data.action === "redeem"
            ? -parsed.data.amount_cents
            : 0;
        const reason =
          parsed.data.action === "renew"
            ? "Renewal"
            : "reason" in parsed.data
            ? parsed.data.reason ?? null
            : null;
        const refType: "appointment" | "manual" | null =
          parsed.data.action === "redeem" && parsed.data.appointment_id
            ? "appointment"
            : "manual";
        const refId =
          parsed.data.action === "redeem" && parsed.data.appointment_id
            ? parsed.data.appointment_id
            : null;
        trx.create(chargeRef, {
          tenant_id: ctx.tenant.id,
          membership_id: id,
          client_id: m.client_id,
          type: chargeType,
          amount_cents: delta,
          balance_after_cents: newBalance,
          reason,
          ref_type: refType,
          ref_id: refId,
          actor_user_id: ctx.user.firebaseUid,
          actor_email: ctx.user.email,
          created_at: now(),
        });
      }

      const auditAction =
        parsed.data.action === "renew"
          ? "membership.renew"
          : parsed.data.action === "cancel"
          ? "membership.cancel"
          : parsed.data.action === "pause" || parsed.data.action === "resume"
          ? "membership.pause"
          : "membership.charge";

      writeAuditInTx(trx, {
        action: auditAction,
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "client_membership",
        targetId: id,
        before: { status: m.status, balance: m.balance_cents },
        after: { status: newStatus, balance: newBalance, action: parsed.data.action },
        ip,
        userAgent: ua,
      });

      return {
        status: newStatus,
        balance_cents: newBalance,
        next_renewal_at: newNextRenewal ? newNextRenewal.toDate().toISOString() : null,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "Not found." ? 404 : msg.includes("Cannot") ? 409 : 500 },
    );
  }
}
