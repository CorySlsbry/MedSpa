import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <main className="bg-[var(--color-cream)] py-20">
      <article className="container-narrow max-w-3xl">
        <div className="tag">Legal</div>
        <h1 className="mt-4">Terms of Service</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          Last updated: 2026-05-04
        </p>

        <div className="prose mt-10 space-y-6 text-[var(--color-ink-soft)]">
          <p>
            By signing up for Aesthera (&quot;the Service&quot;) you agree to these terms.
            If you don&apos;t agree, don&apos;t use the Service.
          </p>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Accounts and access</h2>
          <p>
            You&apos;re responsible for everything that happens under your account. Don&apos;t
            share credentials. Use 2FA. Tell us at <a href="mailto:support@aesthera.io" className="font-semibold text-[var(--color-teal)] hover:underline">person1@example.com</a>{" "}
            if you suspect unauthorized access.
          </p>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Subscription and billing</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>Subscriptions billed monthly via Stripe. Annual prepay options where offered.</li>
            <li>14-day free trial on every tier (no card required for the trial).</li>
            <li>Cancel anytime — service continues through the end of the paid period.</li>
            <li>
              Founding-25 lifetime pricing is locked for the duration of an active,
              uninterrupted subscription. If you cancel and re-subscribe, the founding
              rate does not return.
            </li>
            <li>Refunds are issued at our discretion for verified billing errors.</li>
          </ul>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Acceptable use</h2>
          <p>
            Don&apos;t use Aesthera to violate the law, harass anyone, send unsolicited
            commercial messages, or attempt to compromise the platform. We may suspend
            accounts that violate this — generally with notice and a chance to cure.
          </p>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Your content</h2>
          <p>
            You own your tenant data — clients, charts, photos, financial records. You
            grant Aesthera a limited license to host, process, and back up that data for
            the purpose of operating the Service. We don&apos;t use your tenant data to
            train AI models, period.
          </p>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Service availability</h2>
          <p>
            We aim for high availability and operate on Google Cloud Run. Planned
            maintenance is announced in advance. We don&apos;t guarantee zero downtime;
            see the <Link href="/security" className="font-semibold text-[var(--color-teal)] hover:underline">Security & HIPAA</Link> page
            for current operational posture.
          </p>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Termination</h2>
          <p>
            Either of us may terminate at any time. On termination, you&apos;ll have at
            least 30 days to export your data. After that, data is deleted per the{" "}
            <Link href="/privacy" className="font-semibold text-[var(--color-teal)] hover:underline">Privacy Policy</Link>.
          </p>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Liability</h2>
          <p>
            The Service is provided on an &quot;as-is&quot; basis. To the fullest extent
            permitted by law, our aggregate liability is limited to the fees you paid in
            the 12 months preceding the claim. Nothing in these terms limits liability for
            gross negligence, willful misconduct, or anything that can&apos;t legally be
            limited.
          </p>

          <h2 className="font-display text-2xl font-bold text-[var(--color-navy)]">Governing law</h2>
          <p>
            These terms are governed by the laws of the State of Utah, USA. Disputes go
            through the state and federal courts located in Salt Lake County, Utah.
          </p>

          <p className="mt-12 text-xs text-[var(--color-ink-muted)]">
            Questions? <a href="mailto:support@aesthera.io" className="font-semibold text-[var(--color-teal)] hover:underline">person1@example.com</a>{" "}
            · <Link href="/" className="font-semibold text-[var(--color-teal)] hover:underline">Back to home →</Link>
          </p>
        </div>
      </article>
    </main>
  );
}
