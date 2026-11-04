import type { Metadata } from "next";
import ContactForm from "./ContactForm";

export const metadata: Metadata = {
  title: "Contact · Aesthera",
  description:
    "Get in touch with the Aesthera team. Sales, support, partnerships, and general questions.",
};

export const dynamic = "force-static";

/**
 * Public /contact page. Three direct-mail addresses + a form for people
 * who don't want to open their mail client. Form submissions land in
 * the same /admin/replies queue as inbound email so we draft + reply
 * with the same flow.
 */
export default function ContactPage() {
  return (
    <div className="bg-[var(--color-cream)]">
      <section className="container-narrow max-w-4xl py-16 md:py-24">
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-gold-deep)]">
          Contact
        </div>
        <h1 className="mt-3 text-[var(--color-navy)]">Talk to a real human.</h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--color-ink-soft)]">
          Cory and team read every message. Replies usually land within one
          business day, often the same day.
        </p>

        <div className="mt-12 grid gap-10 md:grid-cols-12">
          {/* Direct addresses */}
          <div className="md:col-span-5">
            <h2 className="font-display text-xl font-bold text-[var(--color-navy)]">
              Email us directly
            </h2>
            <ul className="mt-5 space-y-5 text-sm">
              <li>
                <a
                  href="mailto:support@aesthera.io"
                  className="font-display text-base font-bold text-[var(--color-navy)] hover:underline"
                >
                  person1@example.com
                </a>
                <div className="mt-1 text-[var(--color-ink-soft)]">
                  Account help, onboarding, billing questions. The first stop
                  for existing customers.
                </div>
              </li>
              <li>
                <a
                  href="mailto:hello@aesthera.io"
                  className="font-display text-base font-bold text-[var(--color-navy)] hover:underline"
                >
                  person2@example.com
                </a>
                <div className="mt-1 text-[var(--color-ink-soft)]">
                  Sales, partnerships, demos, general inquiries.
                </div>
              </li>
              <li>
                <a
                  href="mailto:cory@aesthera.io"
                  className="font-display text-base font-bold text-[var(--color-navy)] hover:underline"
                >
                  person3@example.com
                </a>
                <div className="mt-1 text-[var(--color-ink-soft)]">
                  Cory, the founder. Usually slower than support@ but reads
                  every line.
                </div>
              </li>
            </ul>

            <div className="mt-10 rounded-lg border-l-4 border-[var(--color-gold)] bg-[var(--color-cream-deep)]/50 px-4 py-3 text-xs text-[var(--color-ink-soft)]">
              <strong className="block text-sm text-[var(--color-navy)]">
                A note on response time
              </strong>
              We&apos;re a small team. Pricing or evaluation questions go to
              hello@; technical or account issues go to support@. That gets
              your message in front of the right person fastest.
            </div>
          </div>

          {/* Form */}
          <div className="md:col-span-7">
            <h2 className="font-display text-xl font-bold text-[var(--color-navy)]">
              Or send a message here
            </h2>
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              Same inbox as the email addresses above. We&apos;ll write back to
              the address you give.
            </p>
            <div className="mt-5 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-sm md:p-8">
              <ContactForm />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
