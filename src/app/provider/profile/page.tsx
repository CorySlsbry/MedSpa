import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import ProviderProfileView from "@/components/provider/ProviderProfileView";
import type { ProviderDoc, LocationDoc } from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Provider · Profile",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type ProviderProfile = {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  phone: string | null;
  schedulingColor: string | null;
  defaultLocationId: string | null;
};

export type LocationOption = { id: string; name: string };

export default async function ProviderProfilePage() {
  const ctx = await requireTenantContext("tenant_provider");
  const docRef = tenantCol(ctx.tenant.id, "providers").doc(ctx.user.firebaseUid);
  const snap = await docRef.get();

  if (!snap.exists) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Profile
        </h1>
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
          Your provider record isn&apos;t set up yet. Ask the clinic owner to add you.
        </div>
      </div>
    );
  }

  const data = snap.data() as ProviderDoc;
  const profile: ProviderProfile = {
    id: snap.id,
    email: data.email,
    fullName: data.full_name,
    title: data.title,
    phone: data.phone,
    schedulingColor: data.scheduling_color,
    defaultLocationId: data.default_location_id,
  };

  const locSnap = await tenantCol(ctx.tenant.id, "locations")
    .where("is_active", "==", true)
    .orderBy("created_at", "asc")
    .limit(50)
    .get();
  const locations: LocationOption[] = locSnap.docs.map((d) => ({
    id: d.id,
    name: (d.data() as LocationDoc).name,
  }));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Profile
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Edit your display info. Email and active status are managed by your
        clinic owner.
      </p>

      <div className="mt-6">
        <ProviderProfileView initial={profile} locations={locations} />
      </div>
    </div>
  );
}
