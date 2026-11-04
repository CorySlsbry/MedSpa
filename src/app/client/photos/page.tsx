import type { Metadata } from "next";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import { signedReadUrl } from "@/lib/storage";
import type { ClientDoc, PhotoDoc, PhotoKind } from "@/lib/firestore-types";
import ClientPhotosView from "@/components/client/ClientPhotosView";

export const metadata: Metadata = {
  title: "My photos",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type ClientPhotoRow = {
  id: string;
  url: string;
  kind: PhotoKind;
  label: string | null;
  notes: string | null;
  takenAt: Date | null;
  pairId: string | null;
};

export default async function ClientPhotosPage() {
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
          My photos
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Your client record isn&apos;t set up yet.
        </p>
      </div>
    );
  }
  const clientId = cliQuery.docs[0].id;
  const client = cliQuery.docs[0].data() as ClientDoc;

  const photoSnap = await tenantCol(ctx.tenant.id, "photos")
    .where("client_id", "==", clientId)
    .orderBy("created_at", "desc")
    .limit(200)
    .get()
    .catch(() => null);

  const photos: ClientPhotoRow[] = photoSnap
    ? await Promise.all(
        photoSnap.docs.map(async (d) => {
          const data = d.data() as PhotoDoc;
          const { url } = await signedReadUrl({
            storagePath: data.storage_path,
            ttlMinutes: 30,
          });
          return {
            id: d.id,
            url,
            kind: data.kind,
            label: data.label,
            notes: data.notes,
            takenAt: toDate(data.taken_at),
            pairId: data.pair_id,
          };
        }),
      )
    : [];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        My photos
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Your before/after photos at {ctx.tenant.name}, {client.preferred_name ?? client.full_name.split(" ")[0]}.
      </p>

      <div className="mt-6">
        <ClientPhotosView photos={photos} />
      </div>
    </div>
  );
}
