/**
 * /admin/integrations — platform-level integrations.
 *
 * Currently just Google (Calendar + Gmail). Future: Slack, Resend webhooks,
 * Stripe Connect status, Twilio parent account.
 */

import type { Metadata } from "next";
import { getConnectionInfo } from "@/lib/admin-google";
import GoogleIntegrationCard from "@/components/admin/GoogleIntegrationCard";

export const metadata: Metadata = {
  title: "Admin · Integrations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; google_err?: string }>;
}) {
  const sp = await searchParams;
  const google = await getConnectionInfo();

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        Platform integrations
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        Connect platform-wide accounts that Aesthera operates from on your behalf — Calendar
        events when prospects book demos, Gmail polling for inbound replies (future), etc.
      </p>

      {sp.google === "connected" && (
        <div className="mt-4 rounded-lg border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Google connected. New demo bookings will write to your calendar with a Google Meet link.
        </div>
      )}
      {sp.google_err && (
        <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
          Google connection failed: <code>{sp.google_err}</code>. Try again, or check that the
          OAuth client has the redirect URI{" "}
          <code className="font-mono text-[11px]">
            https://aesthera.io/api/admin/integrations/google/callback
          </code>{" "}
          authorized.
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <GoogleIntegrationCard
          connected={!!google?.connected}
          accountEmail={google?.email ?? null}
          accountName={google?.name ?? null}
          scopes={google?.scopes ?? []}
          connectedAt={google?.connectedAt?.toLocaleString() ?? null}
          lastUsedAt={google?.lastUsedAt?.toLocaleString() ?? null}
          lastError={google?.lastError ?? null}
        />
      </div>

      <div className="mt-8 rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-ink-muted)]">
          One-time setup needed
        </div>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          The Google OAuth client (in GCP project <code>medspa-494718</code> or wherever it lives)
          needs the following authorized redirect URI added before connect will work:
        </p>
        <p className="mt-2 rounded bg-[var(--color-cream-deep)] p-2 font-mono text-[12px]">
          https://aesthera.io/api/admin/integrations/google/callback
        </p>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Console: <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-[var(--color-teal)] hover:underline">APIs & Services → Credentials</a>{" "}
          → click your OAuth 2.0 Client ID → add the URI to &quot;Authorized redirect URIs&quot; → Save.
        </p>
      </div>
    </div>
  );
}
