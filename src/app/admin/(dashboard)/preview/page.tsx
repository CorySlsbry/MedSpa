import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/firestore";
import { getSessionUser } from "@/lib/auth-server";
import type { TenantDoc } from "@/lib/firestore-types";
import PreviewLauncher from "@/components/admin/PreviewLauncher";

export const metadata: Metadata = {
  title: "Admin · View as",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Super-admin "View as" launcher. Lists tenants + roles; clicking a
 * combo POSTs to /api/admin/preview/start which sets the
 * aesthera-view-as cookie + redirects you into the chosen portal.
 *
 * Throughout the preview, you remain super_admin under the hood — every
 * audit-log row still attributes to your real account, so there's no
 * forensic ambiguity. A red banner sits at the top of the previewed
 * shell with an Exit button that clears the cookie and brings you back.
 */
const REASON_COPY: Record<string, { headline: string; fix: string }> = {
  no_preview: {
    headline: "Pick a tenant + role to step into.",
    fix: "Super-admins can't browse tenant routes directly — start a preview here so the system knows which clinic + role to render.",
  },
  tenant_missing: {
    headline: "That tenant doesn't exist anymore.",
    fix: "We cleared your stale preview cookie. Pick a current tenant below and try again.",
  },
};

export default async function PreviewLauncherPage({
  searchParams,
}: {
  searchParams?: Promise<{ reason?: string }>;
}) {
  const user = await getSessionUser();
  if (!user || user.role !== "super_admin") {
    return null;
  }
  const params = (await searchParams) ?? {};
  const reason = params.reason && REASON_COPY[params.reason] ? params.reason : null;

  const tenantsSnap = await db()
    .collection("tenants")
    .orderBy("name", "asc")
    .limit(100)
    .get()
    .catch(() => null);
  const tenants = (tenantsSnap?.docs ?? []).map((d) => {
    const t = d.data() as TenantDoc;
    return {
      id: d.id,
      name: t.name ?? d.id,
      tier: t.subscription_tier ?? "basic",
    };
  });

  return (
    <div>
      <Link
        href="/admin"
        className="text-sm text-[var(--color-teal)] hover:underline"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-3 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        View as
      </h1>
      <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
        Step into any tenant role to feel the experience exactly as that user
        would. Your super-admin session stays active under the hood — every
        write is still audited to your real account, no impersonation drift.
        Preview ends after 4 hours or when you click Exit. The tenant idle
        timeout is automatically disabled while you preview so a long
        diagnostic session doesn&apos;t accidentally sign you out of admin.
      </p>

      {reason && (
        <div className="mt-6 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="block font-semibold">{REASON_COPY[reason].headline}</strong>
          <span className="opacity-90">{REASON_COPY[reason].fix}</span>
        </div>
      )}

      {tenants.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 p-6 text-sm text-[var(--color-ink-soft)]">
          No tenants in the system yet. Provision one from{" "}
          <Link href="/admin/tenants" className="font-semibold underline">
            Tenants
          </Link>{" "}
          first.
        </div>
      ) : (
        <PreviewLauncher tenants={tenants} />
      )}

      <div className="mt-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5 text-xs text-[var(--color-ink-muted)]">
        <strong className="block text-sm text-[var(--color-navy)]">
          What each role sees
        </strong>
        <ul className="mt-3 space-y-1.5">
          <li>
            <strong className="text-[var(--color-navy)]">Owner</strong> — full
            clinic data, financials, team, and all-tools AI assistant.
          </li>
          <li>
            <strong className="text-[var(--color-navy)]">Manager</strong> —
            operational dashboards, team management, complaint queue, inventory,
            metrics. Manager AI. No clinical charts.
          </li>
          <li>
            <strong className="text-[var(--color-navy)]">Provider</strong> —
            today&apos;s schedule, patient history, photos, charts. Provider AI.
            No financials, no HR.
          </li>
          <li>
            <strong className="text-[var(--color-navy)]">Front Desk</strong> —
            check-ins, schedule, customer-service inbox, waitlist. Front Desk
            AI. No financials, no HR, no charts.
          </li>
          <li>
            <strong className="text-[var(--color-navy)]">Client</strong> —
            patient self-service portal (next visit, photos, membership). No
            assistant on this layer.
          </li>
        </ul>
      </div>
    </div>
  );
}
