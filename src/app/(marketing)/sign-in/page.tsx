import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth-server";
import TenantSignInForm from "@/components/TenantSignInForm";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ROLE_REDIRECT: Record<string, string> = {
  tenant_owner: "/owner",
  tenant_provider: "/provider",
  tenant_client: "/client",
  super_admin: "/admin",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams?: Promise<{ reason?: string; sent?: string }>;
}) {
  const user = await getSessionUser();
  if (user) {
    redirect(ROLE_REDIRECT[user.role] ?? "/");
  }

  const params = (await searchParams) ?? {};
  const reason = params.reason;
  const sent = params.sent === "1";

  return (
    <section className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-gradient-to-br from-[var(--color-cream)] via-[var(--color-cream-deep)] to-[var(--color-cream)] px-4 py-16">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-8 shadow-[0_30px_80px_-30px_rgba(46,64,87,0.3)] md:p-10">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-navy-deep)] font-display text-lg font-bold text-[var(--color-gold)]">
              A
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold text-[var(--color-navy)]">
              Sign in to Aesthera
            </h1>
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              An AI for every role. Sign in to yours.
            </p>
          </div>

          {reason === "invalid" && (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              That account isn&apos;t recognized. If you&apos;re a clinic
              owner or staff member, ask your admin to invite you.
            </div>
          )}
          {reason === "expired" && (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Your sign-in link expired or was already used. Request a new one.
            </div>
          )}

          {sent ? (
            <div className="mt-8 rounded-lg border-l-4 border-[var(--color-teal)] bg-[var(--color-teal-soft)] px-4 py-4 text-sm text-[var(--color-teal-deep)]">
              <strong className="block font-semibold">Check your email.</strong>
              <span className="mt-1 block">
                We sent a one-time sign-in link. It expires in 15 minutes.
              </span>
            </div>
          ) : (
            <TenantSignInForm />
          )}
        </div>

        <p className="mt-6 text-center text-xs text-[var(--color-ink-muted)]">
          Looking for the platform admin?{" "}
          <a
            href="/admin/login"
            className="font-semibold text-[var(--color-teal)] hover:underline"
          >
            Admin sign-in →
          </a>
        </p>
      </div>
    </section>
  );
}
