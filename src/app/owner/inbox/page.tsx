import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { isSmsConfigured } from "@/lib/sms";
import type { ClientDoc } from "@/lib/firestore-types";
import InboxView from "@/components/owner/InboxView";
import FriendlyErrorBanner from "@/components/FriendlyErrorBanner";

export const metadata: Metadata = {
  title: "Owner · Inbox",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type InboxClientOption = {
  id: string;
  label: string;
  phone: string | null;
};

async function loadClients(tenantId: string): Promise<InboxClientOption[]> {
  const snap = await tenantCol(tenantId, "clients")
    .orderBy("created_at", "desc")
    .limit(500)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => {
    const c = d.data() as ClientDoc;
    return {
      id: d.id,
      label: `${c.full_name} · ${c.phone ?? "no phone"}`,
      phone: c.phone,
    };
  });
}

export default async function InboxPage() {
  const ctx = await requireTenantContext("tenant_owner");
  const smsConfigured = isSmsConfigured();
  const tenantNumber = ctx.tenant.twilio_phone_number;

  const clients = smsConfigured ? await loadClients(ctx.tenant.id) : [];

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            Inbox
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            Two-way SMS with your clients. Replies to your reminders + confirmations land here.
          </p>
        </div>
        {tenantNumber && (
          <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Your SMS line
            </div>
            <div className="font-mono font-semibold text-[var(--color-navy)]">
              {tenantNumber}
            </div>
          </div>
        )}
      </div>

      {!smsConfigured && (
        <div className="mt-6">
          <FriendlyErrorBanner
            error={{
              headline: "Your SMS line isn't connected yet",
              fix: "We provision an SMS number for your clinic during onboarding so two-way texts route here. If you skipped that step or your number changed, kick it off on Settings — takes about 2 minutes.",
              actionHref: "/owner/settings",
              actionLabel: "Connect SMS line",
              severity: "warning",
            }}
          />
        </div>
      )}
      {smsConfigured && !tenantNumber && (
        <div className="mt-6">
          <FriendlyErrorBanner
            error={{
              headline: "Add your Twilio number to start receiving texts",
              fix: "Your account is ready — we just need to attach your dedicated number so inbound replies land here. Add it on Settings.",
              actionHref: "/owner/settings",
              actionLabel: "Open Settings",
              severity: "warning",
            }}
          />
        </div>
      )}

      {smsConfigured && (
        <div className="mt-6">
          <InboxView clients={clients} smsAvailable={!!tenantNumber} />
        </div>
      )}
    </div>
  );
}
