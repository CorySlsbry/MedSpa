import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import { TIER_LIMITS } from "@/lib/tier-limits";
import MembershipsView from "@/components/owner/MembershipsView";
import type {
  MembershipPlanDoc,
  ClientMembershipDoc,
  ClientDoc,
  MembershipBillingPeriod,
  MembershipStatus,
} from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Owner · Memberships",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type PlanRow = {
  id: string;
  name: string;
  description: string | null;
  billingPeriod: MembershipBillingPeriod;
  priceCents: number;
  creditPerPeriodCents: number;
  serviceDiscountPct: number;
  retailDiscountPct: number;
  perksText: string | null;
  isActive: boolean;
};

export type MembershipRow = {
  id: string;
  clientId: string;
  clientName: string | null;
  planId: string;
  planNameSnapshot: string;
  billingPeriodSnapshot: MembershipBillingPeriod;
  priceCentsSnapshot: number;
  status: MembershipStatus;
  startedAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  nextRenewalAt: Date | null;
  canceledAt: Date | null;
  pausedUntil: Date | null;
  balanceCents: number;
  autoBill: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  failedPaymentCount: number;
  notes: string | null;
};

export type ClientOption = { id: string; label: string };

async function loadPlans(tenantId: string): Promise<PlanRow[]> {
  const snap = await tenantCol(tenantId, "membership_plans")
    .orderBy("name", "asc")
    .limit(100)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const p = d.data() as MembershipPlanDoc;
    return {
      id: d.id,
      name: p.name,
      description: p.description,
      billingPeriod: p.billing_period,
      priceCents: p.price_cents,
      creditPerPeriodCents: p.credit_per_period_cents,
      serviceDiscountPct: p.service_discount_pct,
      retailDiscountPct: p.retail_discount_pct,
      perksText: p.perks_text,
      isActive: p.is_active,
    };
  });
}

async function loadMemberships(tenantId: string): Promise<MembershipRow[]> {
  const snap = await tenantCol(tenantId, "client_memberships")
    .orderBy("started_at", "desc")
    .limit(500)
    .get()
    .catch(() => null);
  if (!snap) return [];
  const clientIds = new Set<string>();
  for (const d of snap.docs) {
    const m = d.data() as ClientMembershipDoc;
    clientIds.add(m.client_id);
  }
  const clientMap = new Map<string, string>();
  await Promise.all(
    [...clientIds].map(async (cid) => {
      const cs = await tenantCol(tenantId, "clients").doc(cid).get().catch(() => null);
      if (cs && cs.exists) clientMap.set(cid, (cs.data() as ClientDoc).full_name);
    }),
  );
  return snap.docs.map((d) => {
    const m = d.data() as ClientMembershipDoc;
    return {
      id: d.id,
      clientId: m.client_id,
      clientName: clientMap.get(m.client_id) ?? null,
      planId: m.plan_id,
      planNameSnapshot: m.plan_name_snapshot,
      billingPeriodSnapshot: m.billing_period_snapshot,
      priceCentsSnapshot: m.price_cents_snapshot,
      status: m.status,
      startedAt: toDate(m.started_at),
      currentPeriodStart: toDate(m.current_period_start),
      currentPeriodEnd: toDate(m.current_period_end),
      nextRenewalAt: toDate(m.next_renewal_at),
      canceledAt: toDate(m.canceled_at),
      pausedUntil: toDate(m.paused_until),
      balanceCents: m.balance_cents,
      autoBill: m.auto_bill ?? false,
      cardBrand: m.card_brand ?? null,
      cardLast4: m.card_last4 ?? null,
      failedPaymentCount: m.failed_payment_count ?? 0,
      notes: m.notes,
    };
  });
}

async function loadClients(tenantId: string): Promise<ClientOption[]> {
  const snap = await tenantCol(tenantId, "clients")
    .orderBy("created_at", "desc")
    .limit(500)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const c = d.data() as ClientDoc;
    return { id: d.id, label: `${c.full_name} · ${c.email}` };
  });
}

export default async function MembershipsPage() {
  const ctx = await requireTenantContext("tenant_owner");
  const enabled = TIER_LIMITS[ctx.tenant.subscription_tier].features.memberships;

  let plans: PlanRow[] = [];
  let memberships: MembershipRow[] = [];
  let clients: ClientOption[] = [];
  let errorMsg: string | null = null;
  if (enabled) {
    try {
      [plans, memberships, clients] = await Promise.all([
        loadPlans(ctx.tenant.id),
        loadMemberships(ctx.tenant.id),
        loadClients(ctx.tenant.id),
      ]);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  // Past-due members still represent revenue obligation (collection in
  // progress). Paused/canceled don't. Trialing counts as MRR for SaaS
  // convention even though revenue isn't collected yet.
  const billingActive = (s: typeof memberships[number]["status"]) =>
    s === "active" || s === "trialing" || s === "past_due";
  const activeMembers = memberships.filter((m) => billingActive(m.status)).length;
  const mrr = memberships
    .filter((m) => billingActive(m.status))
    .reduce(
      (sum, m) => sum + (m.billingPeriodSnapshot === "yearly" ? m.priceCentsSnapshot / 12 : m.priceCentsSnapshot),
      0,
    );

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Memberships
        </h1>
        {enabled && memberships.length > 0 && (
          <span className="text-sm text-[var(--color-ink-muted)]">
            {activeMembers} active · ${(mrr / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo MRR
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Recurring membership plans for your clients — perks, credits, and discounts that auto-bill.
      </p>

      {!enabled && (
        <div className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-cream)] px-6 py-12 text-center">
          <h2 className="font-display text-xl font-bold text-[var(--color-navy)]">
            Upgrade to offer memberships
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-soft)]">
            Membership plans are included on Growth and Enterprise. Add recurring revenue with monthly perks, credits, and member discounts.
          </p>
          <a href="/owner/billing" className="btn btn-gold mt-4 inline-block">
            See plans
          </a>
        </div>
      )}

      {errorMsg && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {errorMsg}
        </div>
      )}

      {enabled && (
        <div className="mt-6">
          <MembershipsView
            initialPlans={plans}
            initialMemberships={memberships}
            clients={clients}
          />
        </div>
      )}
    </div>
  );
}
