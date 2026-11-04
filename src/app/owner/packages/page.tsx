import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import PackagesView from "@/components/owner/PackagesView";
import type {
  ClientDoc,
  ClientPackageDoc,
  GiftCardDoc,
  PackagePlanDoc,
} from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Owner · Packages & gift cards",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type PlanRow = {
  id: string;
  name: string;
  description: string | null;
  serviceName: string;
  sessionsTotal: number;
  priceCents: number;
  expiresInDays: number | null;
  isActive: boolean;
};

export type ClientPackageRow = {
  id: string;
  clientId: string;
  clientName: string | null;
  planName: string;
  serviceName: string;
  sessionsTotal: number;
  sessionsRemaining: number;
  priceCents: number;
  source: ClientPackageDoc["source"];
  expiresAt: Date | null;
  createdAt: Date | null;
  isExhausted: boolean;
  isExpired: boolean;
};

export type GiftCardRow = {
  code: string;
  originalAmountCents: number;
  balanceCents: number;
  recipientEmail: string | null;
  recipientName: string | null;
  senderName: string | null;
  message: string | null;
  expiresAt: Date | null;
  source: GiftCardDoc["source"];
  fullyRedeemedAt: Date | null;
  createdAt: Date | null;
};

export type ClientOption = { id: string; label: string };

async function loadPlans(tenantId: string): Promise<PlanRow[]> {
  const snap = await tenantCol(tenantId, "package_plans")
    .orderBy("name", "asc")
    .limit(100)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const p = d.data() as PackagePlanDoc;
    return {
      id: d.id,
      name: p.name,
      description: p.description,
      serviceName: p.service_name,
      sessionsTotal: p.sessions_total,
      priceCents: p.price_cents,
      expiresInDays: p.expires_in_days,
      isActive: p.is_active,
    };
  });
}

async function loadClientPackages(
  tenantId: string,
): Promise<ClientPackageRow[]> {
  const snap = await tenantCol(tenantId, "client_packages")
    .orderBy("created_at", "desc")
    .limit(500)
    .get()
    .catch(() => null);
  if (!snap) return [];

  const clientIds = new Set<string>();
  for (const d of snap.docs) clientIds.add((d.data() as ClientPackageDoc).client_id);
  const clientMap = new Map<string, string>();
  await Promise.all(
    [...clientIds].map(async (cid) => {
      const cs = await tenantCol(tenantId, "clients").doc(cid).get().catch(() => null);
      if (cs && cs.exists) clientMap.set(cid, (cs.data() as ClientDoc).full_name);
    }),
  );

  return snap.docs.map((d) => {
    const p = d.data() as ClientPackageDoc;
    return {
      id: d.id,
      clientId: p.client_id,
      clientName: clientMap.get(p.client_id) ?? null,
      planName: p.plan_name_snapshot,
      serviceName: p.service_name_snapshot,
      sessionsTotal: p.sessions_total,
      sessionsRemaining: p.sessions_remaining,
      priceCents: p.price_cents_snapshot,
      source: p.source,
      expiresAt: toDate(p.expires_at),
      createdAt: toDate(p.created_at),
      isExhausted: p.sessions_remaining <= 0,
      isExpired: p.expires_at ? p.expires_at.toDate().getTime() < Date.now() : false,
    };
  });
}

async function loadGiftCards(tenantId: string): Promise<GiftCardRow[]> {
  const snap = await tenantCol(tenantId, "gift_cards")
    .orderBy("created_at", "desc")
    .limit(200)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const g = d.data() as GiftCardDoc;
    return {
      code: d.id,
      originalAmountCents: g.original_amount_cents,
      balanceCents: g.balance_cents,
      recipientEmail: g.recipient_email,
      recipientName: g.recipient_name,
      senderName: g.sender_name,
      message: g.message,
      expiresAt: toDate(g.expires_at),
      source: g.source,
      fullyRedeemedAt: toDate(g.fully_redeemed_at),
      createdAt: toDate(g.created_at),
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

export default async function PackagesPage() {
  const ctx = await requireTenantContext("tenant_owner");
  const [plans, clientPackages, giftCards, clients] = await Promise.all([
    loadPlans(ctx.tenant.id),
    loadClientPackages(ctx.tenant.id),
    loadGiftCards(ctx.tenant.id),
    loadClients(ctx.tenant.id),
  ]);

  const totalGiftValue = giftCards.reduce(
    (sum, g) => sum + (g.fullyRedeemedAt ? 0 : g.balanceCents),
    0,
  );
  const activePackages = clientPackages.filter(
    (p) => !p.isExhausted && !p.isExpired,
  );

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            Packages & gift cards
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            Series of pre-paid sessions and gift cards your clinic sells. Cash up
            front + locked-in repeat visits.
          </p>
        </div>
        <div className="flex gap-3">
          <Stat
            label="Active packages"
            value={`${activePackages.length}`}
            sub={`${clientPackages.length} total`}
          />
          <Stat
            label="Outstanding gifts"
            value={`$${(totalGiftValue / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            sub={`${giftCards.length} cards`}
          />
        </div>
      </div>

      <div className="mt-6">
        <PackagesView
          initialPlans={plans}
          initialClientPackages={clientPackages}
          initialGiftCards={giftCards}
          clients={clients}
          stripeReady={
            !!ctx.tenant.stripe_connect_account_id &&
            !!ctx.tenant.stripe_connect_charges_enabled
          }
        />
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-2 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </div>
      <div className="mt-0.5 font-display text-lg font-bold text-[var(--color-navy)]">
        {value}
      </div>
      <div className="text-[10px] text-[var(--color-ink-muted)]">{sub}</div>
    </div>
  );
}
