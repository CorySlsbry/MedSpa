import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { isSmsConfigured } from "@/lib/sms";
import type { ClientDoc } from "@/lib/firestore-types";
import InboxView from "@/components/owner/InboxView";
import FriendlyErrorBanner from "@/components/FriendlyErrorBanner";

export const metadata: Metadata = { title: "Front Desk · Inbox", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type ClientOption = { id: string; label: string; phone: string | null };

async function loadClientOptions(tenantId: string): Promise<ClientOption[]> {
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

/**
 * Front-desk inbox — same conversation API the owner uses
 * (/api/owner/conversations/*), now allowed for owner + manager +
 * front-desk roles. Receptionists handle most of the inbound texts so
 * this is a critical day-1 flow.
 */
export default async function FrontDeskInboxPage() {
  const ctx = await requireTenantContext("tenant_front_desk");
  const smsConfigured = isSmsConfigured();
  const tenantNumber = ctx.tenant.twilio_phone_number;
  const clients = smsConfigured ? await loadClientOptions(ctx.tenant.id) : [];

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
            Front Desk · Inbox
          </div>
          <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            Inbox
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            Two-way SMS with clients. Reminders + confirmations route here so
            you can reply, escalate to a provider, or forward to the manager.
          </p>
        </div>
        {tenantNumber && (
          <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Clinic SMS line
            </div>
            <div className="font-mono font-semibold text-[var(--color-navy)]">{tenantNumber}</div>
          </div>
        )}
      </div>

      {!smsConfigured && (
        <div className="mt-6">
          <FriendlyErrorBanner
            error={{
              headline: "Your SMS line isn't connected yet",
              fix: "We provision an SMS number during onboarding so two-way texts route here. The owner can finish setup on Settings.",
              actionHref: "/owner/settings",
              actionLabel: "Open Settings",
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
              fix: "The owner can attach the dedicated number on Settings.",
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
