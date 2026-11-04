import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth-server";
import LoginForm from "@/components/admin/LoginForm";

export const metadata: Metadata = {
  title: "Admin sign-in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ reason?: string; sent?: string; next?: string }>;
}) {
  const user = await getSessionUser();
  if (user) {
    redirect("/admin");
  }

  const params = (await searchParams) ?? {};
  const reason = params.reason;
  const sent = params.sent === "1";
  const next = params.next || "/admin";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-cream-deep)] px-4 py-16">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-8 shadow-[0_30px_80px_-30px_rgba(46,64,87,0.3)] md:p-10">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-navy-deep)] font-display text-lg font-bold text-[var(--color-gold)]">
              A
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold text-[var(--color-navy)]">
              Aesthera CRM
            </h1>
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              Super-admin sign-in. Email + magic link.
            </p>
          </div>

          {reason === "not_admin" && (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              That account doesn&apos;t have super-admin access.
            </div>
          )}

          {reason === "expired" && (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Your session expired. Sign in again.
            </div>
          )}

          {reason === "mfa_required" && (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Two-factor authentication is required for this account. Sign in
              again to complete the second-factor challenge.
            </div>
          )}

          {sent ? (
            <div className="mt-8 rounded-lg border-l-4 border-[var(--color-teal)] bg-[var(--color-teal-soft)] px-4 py-4 text-sm text-[var(--color-teal-deep)]">
              <strong className="block font-semibold">Check your email.</strong>
              <span className="mt-1 block">
                We sent a one-time sign-in link. It expires in 15 minutes. The
                link will only work for the email it was sent to.
              </span>
            </div>
          ) : (
            <LoginForm next={next} />
          )}
        </div>

        <p className="mt-6 text-center text-xs text-[var(--color-ink-muted)]">
          Authorized super-admins only. All sign-in attempts are logged.
        </p>
      </div>
    </div>
  );
}
