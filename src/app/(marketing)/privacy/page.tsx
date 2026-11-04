import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <main className="bg-[var(--color-cream)] py-20">
      <article className="container-narrow max-w-3xl">
        <div className="tag">Legal</div>
        <h1 className="mt-4">Privacy Policy</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          Last updated: 2026-05-04
        </p>

        <div className="prose mt-10 space-y-6 text-[var(--color-ink-soft)]">
          <p>
            Aesthera (&quot;we&quot;, &quot;us&quot;) provides medspa management software to
            clinics and their authorized staff. This page explains, in plain language,
            what data we collect, how we use it, and the controls you have over it.
          </p>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">What we collect</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Marketing site visitors:</strong> name, email, phone (if provided),
              clinic name, and the form-field choices you submit. We log IP and user-agent
              for abuse prevention. Standard analytics events (page views, anonymized
              scroll/click counts) are recorded so we can improve the site.
            </li>
            <li>
              <strong>Clinic accounts (tenant_owner / tenant_provider / tenant_client):</strong>{" "}
              the data you enter and the data your clients provide through booking and
              consent flows — names, contact info, appointments, services rendered,
              SOAP notes, photos, and payment metadata. This is treated as protected
              health information (PHI) under HIPAA when it identifies a patient.
            </li>
            <li>
              <strong>Authentication:</strong> hashed credentials and 2FA factors via
              Google Identity Platform. We never see your password in plaintext.
            </li>
          </ul>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">How we use it</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>To operate Aesthera for you (booking, charting, billing, marketing).</li>
            <li>
              To send transactional email and SMS — sign-in links, appointment reminders,
              receipts, security alerts. Marketing emails go out only to contacts who
              haven&apos;t opted out (<code>email_consent</code> / <code>sms_consent</code>).
            </li>
            <li>To prevent abuse (rate limits, lockout, audit log).</li>
            <li>
              To run aggregated analytics for our own product decisions. We never sell or
              share your data with third parties for advertising.
            </li>
          </ul>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Subprocessors</h2>
          <p>The platform runs on services that may process your data on our behalf:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li><strong>Google Cloud (Firestore, Cloud Run, Identity Platform, Vertex AI):</strong> hosting, auth, AI drafts. Covered by the Google Cloud BAA on Growth+ tiers.</li>
            <li><strong>Stripe:</strong> payments + Stripe Connect. PCI-DSS Level 1.</li>
            <li><strong>Twilio:</strong> SMS (per-tenant subaccounts). HIPAA-eligible.</li>
            <li><strong>Resend:</strong> transactional email.</li>
          </ul>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">HIPAA</h2>
          <p>
            We sign a Business Associate Agreement (BAA) with clinics on Growth and
            Enterprise tiers. The BAA is a separate document — request it via{" "}
            <a href="mailto:support@aesthera.io" className="font-semibold text-[var(--color-teal)] hover:underline">person1@example.com</a>.
          </p>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Your rights</h2>
          <p>
            You can request access to, correction of, or deletion of your personal data
            by emailing <a href="mailto:support@aesthera.io" className="font-semibold text-[var(--color-teal)] hover:underline">person1@example.com</a>.
            Clinics retain ultimate control over their tenant data — we delete on request
            within 30 days of a verified deletion request, except where retention is
            legally required.
          </p>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Contact</h2>
          <p>
            Privacy questions: <a href="mailto:support@aesthera.io" className="font-semibold text-[var(--color-teal)] hover:underline">person1@example.com</a>.
            For DMCA or law-enforcement requests, the same address — we&apos;ll route appropriately.
          </p>

          <p className="mt-12 text-xs text-[var(--color-ink-muted)]">
            This policy may be updated; material changes will be announced by email to
            clinic owners. <Link href="/" className="font-semibold text-[var(--color-teal)] hover:underline">Back to home →</Link>
          </p>
        </div>
      </article>
    </main>
  );
}
