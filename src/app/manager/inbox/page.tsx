import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { isSmsConfigured } from "@/lib/sms";
import type { ClientDoc } from "@/lib/firestore-types";
import InboxView from "@/components/owner/InboxView";
import FriendlyErrorBanner from "@/components/FriendlyErrorBanner";

export const metadata: Metadata = { title: "Manager · Inbox", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ManagerInboxPage() {
  const ctx = await requireTenantContext("tenant_manager");
  const smsConfigured = isSmsConfigured();
  const tenantNumber = ctx.tenant.twilio_phone_number;

  const clients = smsConfigured
    ? await tenantCol(ctx.tenant.id, "clients")
        .orderBy("created_at", "desc")
        .limit(500)
        .get()
        .then((s) =>
          s.docs.map((d) => {
            const c = d.data() as ClientDoc;
            return { id: d.id, label: `${c.full_name} · ${c.phone ?? "no phone"}`, phone: c.phone };
          }),
        )
        .catch(() => [])
    : [];

  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-gold-deep)]">
        Manager · Inbox
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Inbox
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Two-way SMS with clients. As manager you see everything — escalations
        from the front desk land here.
      </p>
      {!smsConfigured && (
        <div className="mt-6">
          <FriendlyErrorBanner
            error={{
              headline: "Your SMS line isn't connected yet",
              fix: "We provision an SMS number during onboarding. The owner can finish setup on Settings.",
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
