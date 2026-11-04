import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-[var(--color-navy-deep)] text-[var(--color-cream)]/80">
      <div className="container-narrow grid gap-12 py-16 md:grid-cols-12">
        {/* Brand */}
        <div className="md:col-span-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-gold)] font-display text-base font-bold text-[var(--color-navy-deep)]">
              A
            </span>
            <span className="font-display text-xl font-bold tracking-tight text-[var(--color-cream)]">
              Aesthera
            </span>
          </div>
          <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-gold)]">
            MedSpa Management Software
          </div>
          <p className="mt-5 max-w-md text-[var(--color-cream)]/75">
            An AI for every role — owner, manager, provider, front desk, client.
            Plus booking, charting, photos, payments, and financials.
            The operations system clinics actually log into.
          </p>

          <div className="mt-7 space-y-1.5 text-sm">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">
              <span className="h-px w-6 bg-[var(--color-gold)]" />
              Contact
            </div>
            <div className="pt-1">
              <a
                href="mailto:support@aesthera.io"
                className="block text-[var(--color-cream)]/85 hover:text-[var(--color-cream)] hover:underline"
              >
                person1@example.com
              </a>
              <span className="text-xs text-[var(--color-cream)]/55">
                Help with your account, onboarding, billing
              </span>
            </div>
            <div className="pt-2">
              <a
                href="mailto:hello@aesthera.io"
                className="block text-[var(--color-cream)]/85 hover:text-[var(--color-cream)] hover:underline"
              >
                person2@example.com
              </a>
              <span className="text-xs text-[var(--color-cream)]/55">
                Sales, partnerships, and general questions
              </span>
            </div>
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">
            <span className="h-px w-6 bg-[var(--color-gold)]" />
            Product
          </div>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><Link href="/#pricing" className="hover:text-[var(--color-cream)]">Pricing</Link></li>
            <li><Link href="/#early-access" className="hover:text-[var(--color-cream)]">Early access</Link></li>
            <li><Link href="/#info" className="hover:text-[var(--color-cream)]">Get more info</Link></li>
            <li><Link href="/sign-in" className="hover:text-[var(--color-cream)]">Sign in</Link></li>
          </ul>
        </div>

        <div className="md:col-span-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">
            <span className="h-px w-6 bg-[var(--color-gold)]" />
            Built for
          </div>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>Med spas</li>
            <li>Aesthetic clinics</li>
            <li>IV therapy lounges</li>
            <li>Lash &amp; brow studios</li>
            <li>Head spas</li>
            <li>Wellness studios</li>
          </ul>
        </div>

        <div className="md:col-span-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">
            <span className="h-px w-6 bg-[var(--color-gold)]" />
            Company
          </div>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><Link href="/contact" className="hover:text-[var(--color-cream)]">Contact</Link></li>
            <li><Link href="/privacy" className="hover:text-[var(--color-cream)]">Privacy</Link></li>
            <li><Link href="/terms" className="hover:text-[var(--color-cream)]">Terms</Link></li>
            <li><Link href="/security" className="hover:text-[var(--color-cream)]">Security &amp; HIPAA</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="container-narrow flex flex-col items-start justify-between gap-3 py-6 text-xs text-[var(--color-cream)]/60 md:flex-row md:items-center">
          <div>© {new Date().getFullYear()} Aesthera. All rights reserved.</div>
          <div>HIPAA-ready · BAA available on Growth &amp; Enterprise tiers</div>
        </div>
      </div>
    </footer>
  );
}
