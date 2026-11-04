import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import type {
  ClientMembershipDoc,
  ClientPackageDoc,
  GiftCardDoc,
  MembershipChargeDoc,
} from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "My membership",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClientMembershipPage() {
  const ctx = await requireTenantContext("tenant_client");
  const cliQuery = await tenantCol(ctx.tenant.id, "clients")
    .where("email", "==", ctx.user.email)
    .limit(1)
    .get()
    .catch(() => null);

  if (!cliQuery || cliQuery.empty) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)]">
          Membership
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Your client record isn&apos;t set up yet.
        </p>
      </div>
    );
  }
  const clientId = cliQuery.docs[0].id;

  // Active memberships
  const memSnap = await tenantCol(ctx.tenant.id, "client_memberships")
    .where("client_id", "==", clientId)
    .orderBy("started_at", "desc")
    .limit(20)
    .get()
    .catch(() => null);

  const memberships =
    memSnap?.docs.map((d) => {
      const m = d.data() as ClientMembershipDoc;
      return {
        id: d.id,
        planName: m.plan_name_snapshot,
        billingPeriod: m.billing_period_snapshot,
        priceCents: m.price_cents_snapshot,
        status: m.status,
        startedAt: toDate(m.started_at),
        currentPeriodEnd: toDate(m.current_period_end),
        nextRenewalAt: toDate(m.next_renewal_at),
        balanceCents: m.balance_cents,
        cardBrand: m.card_brand,
        cardLast4: m.card_last4,
      };
    }) ?? [];

  const activeMembership =
    memberships.find((m) => m.status === "active" || m.status === "trialing") ??
    memberships[0];

  // Recent charges for the active membership
  let charges: { type: string; amount_cents: number; balance_after: number; created_at: Date | null; reason: string | null }[] = [];
  if (activeMembership) {
    const chargesSnap = await tenantCol(ctx.tenant.id, "client_memberships")
      .doc(activeMembership.id)
      .collection("charges")
      .orderBy("created_at", "desc")
      .limit(10)
      .get()
      .catch(() => null);
    if (chargesSnap) {
      charges = chargesSnap.docs.map((d) => {
        const c = d.data() as MembershipChargeDoc;
        return {
          type: c.type,
          amount_cents: c.amount_cents,
          balance_after: c.balance_after_cents,
          created_at: toDate(c.created_at),
          reason: c.reason,
        };
      });
    }
  }

  // Active client packages
  const pkgSnap = await tenantCol(ctx.tenant.id, "client_packages")
    .where("client_id", "==", clientId)
    .orderBy("created_at", "desc")
    .limit(20)
    .get()
    .catch(() => null);
  const packages =
    pkgSnap?.docs
      .map((d) => {
        const p = d.data() as ClientPackageDoc;
        return {
          id: d.id,
          planName: p.plan_name_snapshot,
          serviceName: p.service_name_snapshot,
          sessionsTotal: p.sessions_total,
          sessionsRemaining: p.sessions_remaining,
          source: p.source,
          expiresAt: toDate(p.expires_at),
        };
      })
      .filter((p) => p.sessionsRemaining > 0) ?? [];

  // Active gift cards (matched by recipient_email)
  const giftSnap = await tenantCol(ctx.tenant.id, "gift_cards")
    .where("recipient_email", "==", ctx.user.email)
    .orderBy("created_at", "desc")
    .limit(20)
    .get()
    .catch(() => null);
  const gifts =
    giftSnap?.docs
      .map((d) => {
        const g = d.data() as GiftCardDoc;
        return {
          code: d.id,
          balanceCents: g.balance_cents,
          originalAmountCents: g.original_amount_cents,
          expiresAt: toDate(g.expires_at),
          fullyRedeemedAt: toDate(g.fully_redeemed_at),
        };
      })
      .filter((g) => g.balanceCents > 0 && !g.fullyRedeemedAt) ?? [];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        My membership & credits
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Your standing balance with {ctx.tenant.name}.
      </p>

      {!activeMembership && packages.length === 0 && gifts.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] px-6 py-12 text-center text-sm text-[var(--color-ink-muted)]">
          No active membership, packages, or gift cards on file.
        </div>
      )}

      {activeMembership && (
        <section className="mt-8">
          <div className="overflow-hidden rounded-2xl border border-[var(--color-gold)] bg-[var(--color-paper)] shadow-sm">
            <div className="bg-[var(--color-gold)] px-6 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-navy-deep)]">
              {activeMembership.status === "active" ? "Active member" : activeMembership.status}
            </div>
            <div className="p-6">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">
                    {activeMembership.planName}
                  </h2>
                  <div className="mt-1 text-sm text-[var(--color-ink-muted)]">
                    ${(activeMembership.priceCents / 100).toFixed(0)} /{" "}
                    {activeMembership.billingPeriod === "yearly" ? "year" : "month"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
                    Credit balance
                  </div>
                  <div className="font-display text-3xl font-bold text-[var(--color-navy)]">
                    ${(activeMembership.balanceCents / 100).toFixed(0)}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
                    Renews
                  </div>
                  <div className="mt-0.5 font-semibold text-[var(--color-navy)]">
                    {activeMembership.nextRenewalAt?.toLocaleDateString() ?? "—"}
                  </div>
                </div>
                {activeMembership.cardLast4 && (
                  <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
                      Card on file
                    </div>
                    <div className="mt-0.5 font-semibold text-[var(--color-navy)]">
                      {activeMembership.cardBrand?.toUpperCase()} ••{activeMembership.cardLast4}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {charges.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
              <div className="border-b border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Recent activity
              </div>
              <ul className="divide-y divide-[var(--color-line)]">
                {charges.map((c, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-[var(--color-ink)] capitalize">
                        {c.type.replace(/_/g, " ")}
                      </div>
                      {c.reason && (
                        <div className="text-[10px] text-[var(--color-ink-muted)]">
                          {c.reason}
                        </div>
                      )}
                      <div className="text-[10px] text-[var(--color-ink-muted)]">
                        {c.created_at?.toLocaleDateString() ?? "—"}
                      </div>
                    </div>
                    <div
                      className={`font-display text-sm font-bold ${
                        c.amount_cents >= 0 ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {c.amount_cents >= 0 ? "+" : ""}${(c.amount_cents / 100).toFixed(2)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {packages.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
            Packages
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {packages.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-sm"
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
                  {p.serviceName}
                </div>
                <h3 className="mt-1 font-display text-lg font-bold text-[var(--color-navy)]">
                  {p.planName}
                </h3>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold text-[var(--color-navy)]">
                    {p.sessionsRemaining}
                  </span>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    of {p.sessionsTotal} sessions left
                  </span>
                </div>
                {p.expiresAt && (
                  <div className="mt-2 text-[10px] text-[var(--color-ink-muted)]">
                    Expires {p.expiresAt.toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {gifts.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
            Gift cards
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {gifts.map((g) => (
              <div
                key={g.code}
                className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 shadow-sm"
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
                  Gift card
                </div>
                <div className="mt-1 font-mono text-xs text-[var(--color-ink-soft)]">
                  {g.code}
                </div>
                <div className="mt-3 font-display text-3xl font-bold text-[var(--color-navy)]">
                  ${(g.balanceCents / 100).toFixed(0)}
                </div>
                <div className="text-[10px] text-[var(--color-ink-muted)]">
                  of ${(g.originalAmountCents / 100).toFixed(0)} original
                </div>
                {g.expiresAt && (
                  <div className="mt-2 text-[10px] text-[var(--color-ink-muted)]">
                    Expires {g.expiresAt.toLocaleDateString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
