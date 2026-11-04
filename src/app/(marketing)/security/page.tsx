import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Security & HIPAA",
  robots: { index: true, follow: true },
};

export default function SecurityPage() {
  return (
    <main className="bg-[var(--color-cream)] py-20">
      <article className="container-narrow max-w-3xl">
        <div className="tag">Trust</div>
        <h1 className="mt-4">Security &amp; HIPAA</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          Last reviewed: 2026-05-04
        </p>

        <div className="mt-10 space-y-8 text-[var(--color-ink-soft)]">
          <section>
            <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Hosting and data residency</h2>
            <p className="mt-3">
              Aesthera runs on Google Cloud — Cloud Run for compute, Firestore Native
              for data, Cloud Storage for clinical photos, Identity Platform for auth.
              All data resides in Google&apos;s US multi-region with replication for
              durability. TLS 1.2+ is enforced; HSTS is set with a 2-year max-age and
              preload eligibility.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Authentication</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>Email + password and passwordless magic-link sign-in (Google Identity Platform).</li>
              <li>Two-factor authentication: TOTP authenticator apps and SMS.</li>
              <li>AAL2 (MFA-completed) is enforced on all super-admin routes once MFA is enrolled.</li>
              <li>Account lockout after 5 failed sign-in attempts in 15 minutes.</li>
              <li>New-IP detection sends a security alert email on first sign-in from an unrecognized location.</li>
              <li>Append-only audit log on every sign-in attempt and every CRM mutation.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">HIPAA</h2>
            <p className="mt-3">
              Aesthera is built to be HIPAA-eligible. We sign a Business Associate
              Agreement (BAA) with clinics on Growth and Enterprise tiers. Our hosting
              and subprocessors (Google Cloud, Stripe, Twilio, Resend) are themselves
              HIPAA-eligible and operate under their own BAAs.
            </p>
            <p className="mt-3">
              PHI in motion is TLS-encrypted; at rest in Firestore it&apos;s encrypted
              with Google-managed keys (CMEK migration is on the Enterprise roadmap).
              Photos in Cloud Storage are stored in a private bucket and served only via
              short-lived signed URLs. Access to PHI is gated by tenant role + tenant_id
              custom claims.
            </p>
            <p className="mt-3">
              Request the BAA via{" "}
              <a href="mailto:support@aesthera.io" className="font-semibold text-[var(--color-teal)] hover:underline">person1@example.com</a>.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Application security</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>Strict CSP, X-Frame-Options DENY on /admin, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy locking down camera/mic/geolocation/cohort.</li>
              <li>Per-IP and per-email rate limits on auth and lead-capture endpoints.</li>
              <li>Server-side input validation (zod) on every API endpoint.</li>
              <li>Honeypot field on the public lead form.</li>
              <li>Email enumeration protection: identical 200 responses for valid and invalid emails on magic-link initiation.</li>
              <li>Append-only audit_log Firestore collection (security rules deny update + delete).</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Reporting a vulnerability</h2>
            <p className="mt-3">
              Email <a href="mailto:support@aesthera.io" className="font-semibold text-[var(--color-teal)] hover:underline">person1@example.com</a>{" "}
              with the subject line &quot;Security report&quot;. Please give us a reasonable
              window to fix before disclosing publicly. We acknowledge reports within 2
              business days.
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">SOC 2</h2>
            <p className="mt-3">
              SOC 2 Type 1 is on the roadmap; we&apos;ll publish the report once complete.
              Until then, security questionnaires are answered case-by-case.
            </p>
          </section>

          <p className="mt-12 text-xs text-[var(--color-ink-muted)]">
            <Link href="/" className="font-semibold text-[var(--color-teal)] hover:underline">Back to home →</Link>
          </p>
        </div>
      </article>
    </main>
  );
}
