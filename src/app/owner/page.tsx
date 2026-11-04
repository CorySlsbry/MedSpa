import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContext } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { toDate } from "@/lib/firestore";
import type {
  AppointmentDoc,
  AppointmentStatus,
  ClientDoc,
  ProviderDoc,
} from "@/lib/firestore-types";

export const metadata: Metadata = {
  title: "Owner · Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type UpcomingAppt = {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
  service: string;
  status: AppointmentStatus;
  providerId: string;
  providerName: string;
  clientId: string;
  clientName: string;
};

async function loadDashboard(tenantId: string) {
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [locSnap, provSnap, cliSnap, upcomingSnap] = await Promise.all([
    tenantCol(tenantId, "locations").count().get(),
    tenantCol(tenantId, "providers").count().get(),
    tenantCol(tenantId, "clients").count().get(),
    tenantCol(tenantId, "appointments")
      .where("starts_at", ">=", Timestamp.fromDate(now))
      .where("starts_at", "<=", Timestamp.fromDate(sevenDays))
      .orderBy("starts_at", "asc")
      .limit(10)
      .get()
      .catch(() => null), // missing index — fail gracefully
  ]);

  const upcomingRaw: AppointmentDoc[] = upcomingSnap
    ? upcomingSnap.docs.map((d) => d.data() as AppointmentDoc)
    : [];
  const upcomingIds = upcomingSnap?.docs.map((d) => d.id) ?? [];

  // Resolve provider + client names so the table doesn't show raw UIDs.
  const providerIds = Array.from(new Set(upcomingRaw.map((a) => a.provider_id))).filter(Boolean);
  const clientIds = Array.from(new Set(upcomingRaw.map((a) => a.client_id))).filter(Boolean);
  const [provDocs, cliDocs] = await Promise.all([
    Promise.all(
      providerIds.map((id) =>
        tenantCol(tenantId, "providers")
          .doc(id)
          .get()
          .then((s) => ({ id, name: s.exists ? (s.data() as ProviderDoc).full_name : null })),
      ),
    ),
    Promise.all(
      clientIds.map((id) =>
        tenantCol(tenantId, "clients")
          .doc(id)
          .get()
          .then((s) => ({ id, name: s.exists ? (s.data() as ClientDoc).full_name : null })),
      ),
    ),
  ]);
  const provNames = new Map(provDocs.map((p) => [p.id, p.name]));
  const cliNames = new Map(cliDocs.map((c) => [c.id, c.name]));

  const upcoming: UpcomingAppt[] = upcomingRaw.map((data, idx) => ({
    id: upcomingIds[idx],
    startsAt: toDate(data.starts_at),
    endsAt: toDate(data.ends_at),
    service: data.service,
    status: data.status,
    providerId: data.provider_id,
    providerName: provNames.get(data.provider_id) ?? "Unknown provider",
    clientId: data.client_id,
    clientName: cliNames.get(data.client_id) ?? "Unknown client",
  }));

  return {
    locationCount: locSnap.data().count,
    providerCount: provSnap.data().count,
    clientCount: cliSnap.data().count,
    upcomingCount: upcoming.length,
    upcoming,
  };
}

export default async function OwnerDashboardPage() {
  const ctx = await requireTenantContext("tenant_owner");

  // Redirect first-time owners to the onboarding wizard until they finish.
  if (!ctx.tenant.onboarded_at) {
    redirect("/owner/onboarding");
  }

  let data: Awaited<ReturnType<typeof loadDashboard>>;
  try {
    data = await loadDashboard(ctx.tenant.id);
  } catch (err) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
          Welcome to {ctx.tenant.name}
        </h1>
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
          Couldn&apos;t load your data: {err instanceof Error ? err.message : String(err)}
        </div>
      </div>
    );
  }

  const isEmpty =
    data.locationCount === 0 &&
    data.providerCount === 0 &&
    data.clientCount === 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            Welcome to {ctx.tenant.name}
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            {ctx.tenant.subscription_status === "trialing" && ctx.tenant.trial_ends_at
              ? `Trial — ${formatTrialEnds(ctx.tenant.trial_ends_at)}`
              : `Plan: ${ctx.tenant.subscription_tier.replace(/_/g, "-")}`}
          </p>
        </div>
      </div>

      {isEmpty && <FirstRunSetup />}

      <div className="mt-8 grid gap-4 md:grid-cols-4">
        <Kpi label="Locations" value={data.locationCount} href="/owner/locations" />
        <Kpi label="Providers" value={data.providerCount} href="/owner/providers" />
        <Kpi label="Clients" value={data.clientCount} href="/owner/clients" />
        <Kpi label="Next 7 days" value={data.upcomingCount} href="/owner/appointments" accent />
      </div>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
            Upcoming appointments
          </h2>
          <Link
            href="/owner/appointments"
            className="text-sm font-semibold text-[var(--color-teal)] hover:underline"
          >
            All →
          </Link>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]">
          {data.upcoming.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
              No appointments in the next 7 days.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-cream-deep)]/40 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Service</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {data.upcoming.map((a) => (
                  <tr key={a.id} className="hover:bg-[var(--color-cream-deep)]/30">
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-muted)]">
                      {a.startsAt?.toLocaleString() ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-[var(--color-navy)]">{a.service}</td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                      {a.providerName}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                      {a.clientName}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-ink-soft)]">
                      {a.status.replace(/_/g, " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <FeatureCard
          href="/owner/reports"
          title="Reports + analytics"
          description="Revenue, bookings, retention, and marketing performance — live from your data."
        />
        <FeatureCard
          href="/owner/marketing"
          title="AI marketing engine"
          description="Triggered campaigns based on client behavior. Birthday week, lapsed buyers, post-treatment follow-ups."
        />
        <FeatureCard
          href="/provider/charts"
          title="Provider charting + SOAP"
          description="Draft with AI, sign for immutability. HIPAA-ready (BAA pending). Provider portal."
        />
        <FeatureCard
          href="/owner/settings"
          title="Embed booking widget"
          description="Drop /embed.js into your existing site. Bookings flow straight in. Includes the AI Concierge."
        />
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  href,
  accent = false,
}: {
  label: string;
  value: number;
  href: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-xl border p-5 transition hover:border-[var(--color-gold)] ${
        accent
          ? "border-[var(--color-gold)] bg-[var(--color-paper)] shadow-[0_20px_60px_-30px_rgba(185,143,66,0.4)]"
          : "border-[var(--color-line)] bg-[var(--color-paper)]"
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-bold text-[var(--color-navy)]">
        {value}
      </div>
    </Link>
  );
}

function FirstRunSetup() {
  return (
    <div className="mt-6 rounded-xl border-2 border-dashed border-[var(--color-gold)]/50 bg-[var(--color-gold)]/5 p-6">
      <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
        ✨ Welcome — let&apos;s get you set up
      </h2>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        Four quick steps to start running your clinic on Aesthera:
      </p>
      <ol className="mt-4 space-y-2 text-sm">
        <SetupStep n={1} href="/owner/locations" title="Add your locations">
          At least one. Each location has its own schedule and providers.
        </SetupStep>
        <SetupStep n={2} href="/owner/providers" title="Invite your providers">
          They&apos;ll get a magic link to set up their account.
        </SetupStep>
        <SetupStep n={3} href="/owner/services" title="Publish your service catalog">
          Each service shows up in the booking widget with its duration and price.
        </SetupStep>
        <SetupStep n={4} href="/owner/settings" title="Embed the booking widget">
          Drop two lines into your existing site to take real bookings.
        </SetupStep>
      </ol>
    </div>
  );
}

function SetupStep({
  n,
  href,
  title,
  children,
}: {
  n: number;
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-gold)] text-[10px] font-bold text-[var(--color-navy-deep)]">
        {n}
      </span>
      <span>
        <Link href={href} className="font-bold text-[var(--color-navy)] hover:underline">
          {title}
        </Link>
        <span className="text-[var(--color-ink-soft)]"> — {children}</span>
      </span>
    </li>
  );
}

function FeatureCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 transition hover:border-[var(--color-gold)]"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-[var(--color-navy)]">
          {title}
        </h3>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
          Live
        </span>
      </div>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{description}</p>
    </Link>
  );
}

function formatTrialEnds(ts: Timestamp): string {
  const d = ts.toDate();
  const days = Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "trial ended";
  if (days === 1) return "trial ends tomorrow";
  return `trial ends in ${days} days`;
}
