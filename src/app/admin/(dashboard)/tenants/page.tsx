import { db, toDate } from "@/lib/firestore";
import type { TenantDoc, TenantSubscriptionTier, TenantStatus } from "@/lib/firestore-types";
import CreateTenantForm from "@/components/admin/CreateTenantForm";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  type: string;
  ownerEmail: string;
  tier: TenantSubscriptionTier;
  status: TenantStatus;
  trialEndsAt: Date | null;
  createdAt: Date | null;
};

async function loadTenants(): Promise<Row[]> {
  try {
    const snap = await db()
      .collection("tenants")
      .orderBy("created_at", "desc")
      .limit(200)
      .get();
    return snap.docs.map((d) => {
      const data = d.data() as TenantDoc;
      return {
        id: d.id,
        name: data.name,
        type: data.type,
        ownerEmail: data.owner_email,
        tier: data.subscription_tier,
        status: data.subscription_status,
        trialEndsAt: toDate(data.trial_ends_at),
        createdAt: toDate(data.created_at),
      };
    });
  } catch (err) {
    console.error("[tenants-list] error", err);
    return [];
  }
}

export default async function TenantsPage() {
  const rows = await loadTenants();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Tenants
        </h1>
        <span className="text-sm text-[var(--color-ink-muted)]">
          {rows.length} {rows.length === 1 ? "clinic" : "clinics"}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Each tenant is one clinic (or clinic group). Creating a tenant
        provisions a Firebase user for the owner and tags them with the
        <code className="font-mono"> tenant_owner</code> role.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        <div className="md:col-span-1">
          <CreateTenantForm />
        </div>
        <div className="md:col-span-2">
          <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3">Clinic</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Tier</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Trial</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-[var(--color-ink-muted)]">
                      No tenants yet. Provision the first clinic on the left.
                    </td>
                  </tr>
                )}
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-[var(--color-cream-deep)]/30">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[var(--color-navy)]">{t.name}</div>
                      <div className="text-[10px] text-[var(--color-ink-muted)]">
                        {t.type.replace(/_/g, " ")} · {t.id}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                      <a href={`mailto:${t.ownerEmail}`} className="hover:underline">
                        {t.ownerEmail}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <TierPill tier={t.tier} />
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                      {t.status}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                      {t.trialEndsAt ? `ends ${t.trialEndsAt.toLocaleDateString()}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function TierPill({ tier }: { tier: TenantSubscriptionTier }) {
  const colors: Record<TenantSubscriptionTier, string> = {
    founding_25: "bg-[var(--color-gold)]/30 text-[var(--color-gold-deep)]",
    basic: "bg-gray-100 text-gray-700",
    growth: "bg-[var(--color-teal)]/15 text-[var(--color-teal-deep)]",
    enterprise: "bg-[var(--color-navy)] text-[var(--color-cream)]",
  };
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${colors[tier]}`}>
      {tier.replace(/_/g, "-")}
    </span>
  );
}
