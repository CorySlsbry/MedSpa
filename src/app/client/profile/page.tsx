import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import type { ClientDoc } from "@/lib/firestore-types";
import ClientProfileForm from "@/components/client/ClientProfileForm";

export const metadata: Metadata = {
  title: "My profile",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type ClientProfile = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  preferredName: string | null;
  emailConsent: boolean;
  smsConsent: boolean;
};

export default async function ClientProfilePage() {
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
          Profile
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Your client record isn&apos;t set up yet.
        </p>
      </div>
    );
  }
  const data = cliQuery.docs[0].data() as ClientDoc;
  const profile: ClientProfile = {
    id: cliQuery.docs[0].id,
    fullName: data.full_name,
    email: data.email,
    phone: data.phone,
    preferredName: data.preferred_name,
    emailConsent: data.email_consent,
    smsConsent: data.sms_consent,
  };

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        My profile
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Update your contact info and communication preferences for{" "}
        {ctx.tenant.name}.
      </p>

      <div className="mt-6">
        <ClientProfileForm initial={profile} />
      </div>
    </div>
  );
}
