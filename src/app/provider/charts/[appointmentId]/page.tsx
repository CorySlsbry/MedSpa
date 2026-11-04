import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import ChartEditor from "@/components/provider/ChartEditor";
import ChartPhotos from "@/components/provider/ChartPhotos";
import { limitsFor } from "@/lib/tier-limits";
import type {
  AppointmentDoc,
  ChartDoc,
  ClientDoc,
  ChartStatus,
} from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Provider · Chart",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type ChartView = {
  appointmentId: string;
  service: string;
  startsAt: Date | null;
  clientName: string;
  clientEmail: string;
  chart: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    status: ChartStatus;
    signedAt: Date | null;
    signedByFullName: string | null;
  };
};

export default async function ChartEditorPage({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
}) {
  const ctx = await requireTenantContext("tenant_provider");
  const { appointmentId } = await params;

  const apptSnap = await tenantCol(ctx.tenant.id, "appointments").doc(appointmentId).get();
  if (!apptSnap.exists) notFound();
  const appt = apptSnap.data() as AppointmentDoc;
  if (appt.provider_id !== ctx.user.firebaseUid) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Chart
        </h1>
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
          That appointment isn&apos;t assigned to you.
        </div>
      </div>
    );
  }

  // Client info
  const cliSnap = await tenantCol(ctx.tenant.id, "clients").doc(appt.client_id).get();
  const cli = cliSnap.exists ? (cliSnap.data() as ClientDoc) : null;

  // Existing chart (if any)
  const chartSnap = await tenantCol(ctx.tenant.id, "charts").doc(appointmentId).get();
  const chart = chartSnap.exists ? (chartSnap.data() as ChartDoc) : null;

  const initial: ChartView = {
    appointmentId,
    service: appt.service,
    startsAt: toDate(appt.starts_at),
    clientName: cli?.full_name ?? "Unknown client",
    clientEmail: cli?.email ?? "",
    chart: {
      subjective: chart?.subjective ?? "",
      objective: chart?.objective ?? "",
      assessment: chart?.assessment ?? "",
      plan: chart?.plan ?? "",
      status: chart?.status ?? "draft",
      signedAt: toDate(chart?.signed_at ?? null),
      signedByFullName: chart?.signed_by_full_name ?? null,
    },
  };

  return (
    <div>
      <Link href="/provider" className="text-sm text-[var(--color-teal)] hover:underline">
        ← Today
      </Link>
      <h1 className="mt-3 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        {initial.service}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        {initial.clientName} · {initial.clientEmail} ·{" "}
        {initial.startsAt ? initial.startsAt.toLocaleString() : "—"}
      </p>

      <div className="mt-6 space-y-6">
        <ChartEditor initial={initial} />
        {limitsFor(ctx.tenant).features.photos_before_after && (
          <ChartPhotos
            clientId={appt.client_id}
            appointmentId={appointmentId}
            chartId={appointmentId}
            signed={initial.chart.status === "signed"}
          />
        )}
      </div>
    </div>
  );
}
