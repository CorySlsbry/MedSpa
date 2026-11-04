import Link from "next/link";
import type { Metadata } from "next";
import { Check, Sparkles, ArrowRight, Zap, Shield, BadgeCheck, Lock, KeyRound, FileCheck2, ServerCog } from "lucide-react";
import DemoRequestForm from "@/components/DemoRequestForm";
import HeroDashboardMockup from "@/components/marketing/HeroDashboardMockup";
import { BookDemoBtn } from "@/components/marketing/HeroBookCta";
import Reveal from "@/components/marketing/Reveal";
import IntegrationStrip from "@/components/marketing/IntegrationStrip";
import SevenToOne from "@/components/marketing/SevenToOne";
import MetricsBand from "@/components/marketing/MetricsBand";
import AITypeDemo from "@/components/marketing/AITypeDemo";
import FoundingProgress from "@/components/marketing/FoundingProgress";

export const metadata: Metadata = {
  // Use absolute title (parent template won't be applied) so the marketing
  // page reads cleanly as "Aesthera · MedSpa Management Software..." and
  // doesn't get a redundant "— Aesthera" suffix from the layout.
  title: {
    absolute: "Aesthera · MedSpa Management Software for Med Spas & Wellness Studios",
  },
  description:
    "An AI for every role — owner, manager, provider, front desk, client. Each one trained on their data and scoped to their job. Plus booking, charting, photos, payments, and financials. The only MedSpa platform built this way.",
  alternates: { canonical: process.env.NEXT_PUBLIC_SITE_URL || "/" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Content blocks. Conversion-optimized order:
// hero → problem → role-based features → AI edge → multi-location → integration
// → pricing → early access → FAQ → final CTA. Sells the next step at every break.
// ─────────────────────────────────────────────────────────────────────────────

const PAIN_TOOLS = [
  { name: "Booking", tool: "Mindbody / Boulevard / Vagaro" },
  { name: "Charting", tool: "Paper / spreadsheet / EMR" },
  { name: "Photos", tool: "iPhone camera roll" },
  { name: "Marketing", tool: "Mailchimp / Klaviyo / nothing" },
  { name: "Bookkeeping", tool: "QuickBooks" },
  { name: "Ads", tool: "Meta Ads Manager / Google Ads" },
  { name: "Reviews", tool: "Birdeye / GMB / nothing" },
];

const ROLE_FEATURES = [
  {
    role: "For Owners",
    eyebrow: "OWNER PORTAL",
    headline: "See every location at a glance. Decide on Monday morning.",
    summary:
      "One dashboard rolls up financials, capacity, and ad spend across every clinic you operate — so the question 'how is the business doing?' has a 60-second answer.",
    bullets: [
      "Consolidated P&L across all locations, live to within an hour",
      "Capacity rate by location, by provider, by service",
      "Ad spend → bookings → revenue attribution in one view",
      "Per-injector and per-service margin",
      "13-week cash forecast with scenario toggles",
      "Drill into any location, any provider, any week",
    ],
    cta: { label: "Show me the owner view", href: "#info" },
  },
  {
    role: "For Providers",
    eyebrow: "PROVIDER PORTAL",
    headline: "Charts that match how you actually work.",
    summary:
      "Customizable charting, SOAP notes, photo markup with before-and-after, and digital signatures — all in one place. No more juggling iPad notes, paper consents, and a separate camera roll.",
    bullets: [
      "Customizable chart templates per service type",
      "SOAP notes with smart-fill from the last visit",
      "Photo markup with before/after pairing and annotation",
      "Secure digital signatures (consent + treatment auth)",
      "Inventory deduction ties to charted services automatically",
      "HIPAA-ready audit trail on every record",
    ],
    cta: { label: "See provider charting", href: "#info" },
  },
  {
    role: "For Clients",
    eyebrow: "CLIENT PORTAL",
    headline: "The booking experience your clients keep coming back to.",
    summary:
      "Embed our booking widget on the website you already have. Clients book, pay deposits, sign consents, view their photos, and rebook — all without your front desk lifting a finger.",
    bullets: [
      "Embed-on-your-site booking — no domain swap, no SEO loss",
      "Self-serve membership management",
      "Before-and-after gallery (private, opt-in)",
      "One-tap rebook with personalized AI recommendations",
      "Two-way SMS that routes to your team",
      "Automated review requests timed by behavior",
    ],
    cta: { label: "Try the client booking flow", href: "#info" },
  },
];

const AI_FEATURES = [
  {
    title: "Treatment Plan Generator",
    summary:
      "Your provider walks in, the AI has already drafted a personalized plan based on the client's intake form, history, photos, and goals. The provider edits and approves — saving 15 minutes per consult.",
    proof: "Average consult prep time drops from 22 minutes to 7.",
  },
  {
    title: "Marketing Engine",
    summary:
      "Triggered campaigns based on real client behavior — birthday week, lapsed retail buyer, post-treatment 21-day check-in, members who skipped two months. Not 'send a newsletter.' Specific. Personal. Automatic.",
    proof: "Beta clients see 3.2x lift in repeat visits inside 90 days.",
  },
];

const PRICING = [
  {
    name: "Basic",
    price: "$199",
    per: "/ month / location",
    description: "Single-location starter. Everything you need to run one clinic.",
    bestFor: "Solo or 1–3 providers, single location.",
    features: [
      "Up to 3 providers",
      "Client booking + records",
      "Provider charting (SOAP + signatures)",
      "Photo before/after",
      "Stripe payments",
      "Embed booking on your existing site",
      "Email support",
    ],
    cta: "Request a demo",
    href: "#info",
    featured: false,
  },
  {
    name: "Growth",
    price: "$399",
    per: "/ month / location",
    description: "Most owners pick this. AI marketing + multi-provider charting.",
    bestFor: "4–15 providers, single or coming-soon multi-location.",
    features: [
      "Everything in Basic",
      "Unlimited providers",
      "AI marketing engine",
      "AI treatment plan drafts",
      "Membership management",
      "Inventory tied to charted services",
      "Two-way SMS (1,500 / mo)",
      "Slack-grade priority support",
    ],
    cta: "Request a demo",
    href: "#info",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "$899",
    per: "/ month / location",
    description: "Multi-location operators ready to consolidate everything.",
    bestFor: "2+ locations, multi-state, growth-mode operators.",
    features: [
      "Everything in Growth",
      "Multi-location owner dashboard",
      "Cross-location ad spend attribution",
      "Per-location P&L roll-up",
      "Custom charting templates",
      "API + Zapier",
      "Dedicated success manager",
      "Custom onboarding (4 wks)",
    ],
    cta: "Talk to founders",
    href: "#info",
    featured: false,
  },
];

const FAQS = [
  {
    q: "How is this different from Mindbody, Boulevard, or Vagaro?",
    a: "Those tools are excellent at booking. Aesthera adds what they don't: provider charting with photo markup, multi-location owner financials, and AI that actually drafts treatment plans and marketing for you. Most of our clients keep their existing booking system and use Aesthera on top — and others switch to ours because it's all in one place.",
  },
  {
    q: "Do I have to switch off my current website?",
    a: "No. Our booking widget embeds on the site you already have. You keep your domain, your SEO, your design. Bookings, payments, and consents all flow into Aesthera. Less risk, faster launch.",
  },
  {
    q: "Is it HIPAA-ready?",
    a: "Yes. AES-256 encryption at rest and TLS 1.2+ in transit. MFA (TOTP + SMS) with AAL2 enforcement on every admin page. 15-minute idle auto-logoff per HIPAA §164.312(a)(2)(iii). Append-only audit log on every write — security rules deny update and delete. Account lockout after 5 failed sign-in attempts. Hosted on HIPAA-eligible Google Cloud Platform with a signed BAA. We sign a BAA with you at the Growth and Enterprise tiers. Resend, Twilio, and Anthropic BAAs are signed or available; Stripe never sees PHI.",
  },
  {
    q: "What does onboarding look like?",
    a: "Basic: self-serve, ~2 hours of setup. Growth: guided 1-week onboarding with our team. Enterprise: 4-week white-glove implementation including data migration from your current systems and team training.",
  },
  {
    q: "Can I export my data if I ever leave?",
    a: "Always. Full client records, charts, photos, and financials export to CSV / PDF on demand. No lock-in. We earn your business every month.",
  },
  {
    q: "What if it doesn't work for my clinic?",
    a: "Two safety nets. (1) 14-day free trial — no credit card to start. Spend two full weeks inside the platform, run real bookings, charts, and photos through it. If it isn't right, just walk away. (2) 30-day money-back guarantee — once you're a paid customer, you have 30 more days to change your mind. We refund every dollar, no questions, no friction. The white-glove onboarding fee is also 100% refundable up to the kickoff call.",
  },
  {
    q: "How does the Early Access Developer Special work?",
    a: "First 25 founding clinics lock in $99/month for life — that's everything in the Growth tier ($399/mo) at a 75% discount, locked forever as long as your account stays active. In return we ask for honest feedback, a few founder calls per quarter, and the right to share anonymized metrics. Once 25 are claimed, the offer closes.",
  },
];

export default function PlatformPage() {
  return (
    <>
      {/* HERO */}
      <section className="relative isolate overflow-hidden bg-[var(--color-navy-deep)] pt-20 pb-16 text-[var(--color-cream)] md:pt-28 md:pb-24">
        {/* Layer 0 — base navy gradient (so the image still feels on-brand if it fails to load) */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-30"
          style={{
            background:
              "linear-gradient(135deg, #1b2636 0%, #2e4057 40%, #07667a 90%, #044c5c 100%)",
          }}
        />
        {/* Layer 1 — full-bleed medspa photo at 65% opacity. Unsplash photo by
             Diana Polekhina (CC0): close-up of a med-spa treatment room with
             warm lighting and a serene aesthetic. Hotlinked from Unsplash CDN
             with auto-format + quality presets so we don't ship a binary in
             the repo. Fallback color = navy-deep so the layout never collapses. */}
        <div aria-hidden="true" className="absolute inset-0 -z-20 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=2400&q=80&auto=format&fit=crop"
            alt=""
            className="h-full w-full object-cover opacity-65"
            loading="eager"
            fetchPriority="high"
          />
          {/* Brand-tinted gradient overlay so the image reads as Aesthera-branded
               and the hero copy keeps WCAG-pass contrast on every screen size. */}
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-navy-deep)]/70 via-[var(--color-navy-deep)]/40 to-[var(--color-teal-deep)]/55" />
        </div>
        {/* Layer 2 — texture + drift orbs over the image */}
        <div aria-hidden="true" className="absolute inset-0 -z-10 grid-dots opacity-[0.07]" />
        <div
          aria-hidden="true"
          className="absolute -top-40 -right-32 -z-10 h-[640px] w-[640px] rounded-full bg-[var(--color-gold)]/15 blur-3xl animate-drift-orb"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-40 -left-32 -z-10 h-[560px] w-[560px] rounded-full bg-[var(--color-teal)]/30 blur-3xl animate-drift-orb"
          style={{ animationDelay: "4s" }}
        />

        <div className="container-narrow relative">
          <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-gold)]/40 bg-[var(--color-gold)]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-gold)] opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-gold)]" />
                </span>
                Early Access · Founding-25
              </div>
              <h1 className="mt-6 text-[var(--color-cream)]">
                An AI for <span className="hand-underline">every</span> role in your med spa.
              </h1>
              <div className="mt-6 h-1 w-12 rounded bg-[var(--color-gold)]" />
              <p className="mt-7 text-lg leading-relaxed text-[var(--color-cream)]/90 md:text-xl">
                <strong className="font-semibold text-[var(--color-cream)]">Owner, manager, provider, front desk, client</strong> — each one gets an assistant trained on their data and scoped to their job.
              </p>
              <p className="mt-4 text-base leading-relaxed text-[var(--color-cream)]/75">
                Plus the booking, charting, photos, payments, and financials. The operations system clinics actually want to log into — and the only MedSpa platform built this way.
              </p>
              <div className="mt-10 flex flex-wrap gap-4">
                <BookDemoBtn dataCta="Hero · Book a demo">Book a 15-min demo</BookDemoBtn>
                <Link href="#early-access" className="btn btn-ghost-light" data-cta="Hero · See founding-25">
                  See the founding-25 offer
                </Link>
              </div>

              {/* Risk-reversal trust strip — 14-day trial + 30-day money-back */}
              <div className="mt-7 inline-flex flex-wrap items-center gap-x-3 gap-y-2 rounded-full border border-[var(--color-gold)]/30 bg-[var(--color-gold)]/5 px-4 py-2 text-xs font-semibold text-[var(--color-cream)]/95">
                <span className="flex items-center gap-1.5">
                  <BadgeCheck className="h-3.5 w-3.5 text-[var(--color-gold)]" strokeWidth={2.5} />
                  14-day free trial
                </span>
                <span className="text-[var(--color-cream)]/30">·</span>
                <span className="flex items-center gap-1.5">
                  <BadgeCheck className="h-3.5 w-3.5 text-[var(--color-gold)]" strokeWidth={2.5} />
                  30-day money-back guarantee
                </span>
                <span className="text-[var(--color-cream)]/30">·</span>
                <span className="flex items-center gap-1.5">
                  <BadgeCheck className="h-3.5 w-3.5 text-[var(--color-gold)]" strokeWidth={2.5} />
                  No credit card to start
                </span>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-[var(--color-cream)]/70">
                <span className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-[var(--color-gold)]" strokeWidth={3} />
                  Founder-led · built with founding clinics
                </span>
                <span className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-[var(--color-gold)]" strokeWidth={2.5} />
                  HIPAA-ready · BAA on Growth+
                </span>
                <span className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-[var(--color-gold)]" strokeWidth={2.5} />
                  Embeds on your existing site
                </span>
              </div>
            </div>

            <div className="lg:col-span-6">
              <HeroDashboardMockup />
            </div>
          </div>
        </div>
      </section>

      {/* METRICS BAND */}
      <section className="relative overflow-hidden bg-[var(--color-navy-deep)] py-12 md:py-16">
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-[var(--color-navy-deep)] via-[var(--color-navy)]/95 to-[var(--color-navy-deep)]"
        />
        <div className="relative">
          <MetricsBand />
        </div>
      </section>

      {/* PROBLEM — replace 7 tools with 1 */}
      <section className="grain relative py-24 md:py-32">
        <div className="container-narrow">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <div className="tag mx-auto justify-center">The reality of running a clinic today</div>
              <h2 className="mt-5">The average spa runs on seven different tools.</h2>
              <div className="rule-gold mx-auto mt-6" />
              <p className="mt-7 text-lg text-[var(--color-ink-soft)]">
                Each one solves a slice. None of them talk to each other. Your front desk types the same client name into four systems before lunch — and you still don&apos;t have a single number that tells you how the business is doing.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="mt-16">
              <SevenToOne />
            </div>
          </Reveal>

          <div className="mt-14 text-center">
            <BookDemoBtn dataCta="Problem · Book demo">Show me a 15-minute demo</BookDemoBtn>
          </div>
        </div>
      </section>

      {/* ROLE-BASED FEATURES */}
      <section className="bg-[var(--color-cream-deep)] py-24 md:py-32">
        <div className="container-narrow">
          <div className="mx-auto max-w-2xl text-center">
            <div className="tag">Three roles. One platform.</div>
            <h2 className="mt-5">Built for the way clinics actually work.</h2>
            <div className="rule-gold mx-auto mt-6" />
            <p className="mt-7 text-lg text-[var(--color-ink-soft)]">
              Owner. Provider. Client. Each one gets a portal designed for their job — and they all share the same data, in real time.
            </p>
          </div>

          <div className="mt-14 space-y-16 md:space-y-24">
            {ROLE_FEATURES.map((r, i) => (
              <Reveal key={r.role} delay={i * 60}>
                <div className={`grid gap-10 md:grid-cols-12 md:items-center ${i % 2 === 1 ? "md:[&>div:first-child]:order-2" : ""}`}>
                  <div className="md:col-span-6">
                    <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">{r.eyebrow}</div>
                    <h3 className="mt-4 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">{r.headline}</h3>
                    <div className="rule-gold mt-5" />
                    <p className="mt-6 text-[var(--color-ink-soft)]">{r.summary}</p>
                    <ul className="mt-6 space-y-3">
                      {r.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-3">
                          <Check className="mt-1 h-4 w-4 flex-shrink-0 text-[var(--color-teal)]" strokeWidth={3} />
                          <span className="text-sm text-[var(--color-ink)]">{b}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-7">
                      <Link href={r.cta.href} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-teal)] hover:underline">
                        {r.cta.label} <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </Link>
                    </div>
                  </div>

                  {/* Mockup card */}
                  <div className="md:col-span-6">
                    <DashboardMockup role={r.role} />
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* AI EDGE */}
      <section className="py-24 md:py-32">
        <div className="container-narrow">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-teal)]/30 bg-[var(--color-teal-soft)] px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-[var(--color-teal-deep)]">
                <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                The competitive edge
              </div>
              <h2 className="mt-5">Two AIs working for your clinic, 24/7.</h2>
              <div className="rule-gold mx-auto mt-6" />
              <p className="mt-7 text-lg text-[var(--color-ink-soft)]">
                Not &quot;AI features&quot; bolted on. AI as the layer underneath every workflow — drafting clinical notes before consults, sending marketing the moment behavior changes, catching what your team can&apos;t see.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="mt-16">
              <AITypeDemo />
            </div>
          </Reveal>

          <Reveal delay={200}>
            <div className="mt-16 grid gap-6 md:grid-cols-2">
              {AI_FEATURES.map((ai, i) => (
                <div key={ai.title} className="relative overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-8 shadow-[0_20px_60px_-30px_rgba(46,64,87,0.25)]">
                  <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-[var(--color-gold)]/10 blur-2xl" aria-hidden="true" />
                  <div className="relative">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-navy)] font-display text-lg font-bold text-[var(--color-gold)]">
                      {i + 1}
                    </div>
                    <h3 className="mt-5 font-display text-xl font-bold text-[var(--color-navy)]">{ai.title}</h3>
                    <p className="mt-3 text-[var(--color-ink-soft)]">{ai.summary}</p>
                    <div className="mt-5 rounded-lg border-l-4 border-[var(--color-gold)] bg-[var(--color-cream-deep)] px-4 py-3 text-sm font-semibold text-[var(--color-navy)]">
                      {ai.proof}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>

          <div className="mt-12 text-center">
            <BookDemoBtn dataCta="AI · Book AI demo">See the AI live in a demo</BookDemoBtn>
          </div>
        </div>
      </section>

      {/* INTEGRATION STRIP */}
      <section className="bg-[var(--color-cream-deep)] py-24 md:py-32">
        <Reveal>
          <IntegrationStrip />
        </Reveal>
      </section>

      {/* MULTI-LOCATION */}
      <section className="bg-[var(--color-navy-deep)] py-24 text-[var(--color-cream)] md:py-32">
        <div
          aria-hidden="true"
          className="absolute inset-0 grid-dots opacity-[0.04]"
        />
        <div className="container-narrow relative grid gap-12 md:grid-cols-12 md:items-center">
          <div className="md:col-span-5">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">Built for operators</div>
            <h2 className="mt-5 text-[var(--color-cream)]">Two locations? Five? Twenty?</h2>
            <div className="mt-6 h-1 w-12 rounded bg-[var(--color-gold)]" />
            <p className="mt-7 text-lg text-[var(--color-cream)]/85">
              Most platforms force you to log in and out of each location's account to see anything. Aesthera was built multi-location from day one. Toggle a dropdown — see the consolidated view, or any single clinic, instantly.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Roll-up P&L across all locations, live",
                "Capacity heatmap by location and provider",
                "Ad spend → bookings → revenue, attributed by location",
                "Open/close any location in one click",
                "Per-location compliance and HIPAA logs",
              ].map((b) => (
                <li key={b} className="flex items-start gap-3 text-[var(--color-cream)]/95">
                  <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--color-gold)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-7">
            <MultiLocationMockup />
          </div>
        </div>
      </section>

      {/* INTEGRATION */}
      <section className="py-24 md:py-32">
        <div className="container-narrow grid gap-12 md:grid-cols-12 md:items-center">
          <div className="md:col-span-7 md:order-2">
            <div className="tag">Plays nicely with what you have</div>
            <h2 className="mt-5">Embed on the site you already love.</h2>
            <div className="rule-gold mt-6" />
            <p className="mt-7 text-lg text-[var(--color-ink-soft)]">
              You spent years getting your website to look right and rank on Google. Don't lose any of it. Aesthera's booking widget drops onto your existing site in 5 minutes. Bookings, payments, intake forms, consents, and follow-ups all flow back into the platform — invisible to your client.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "WordPress, Squarespace, Webflow, Wix, custom — all supported",
                "One-line embed snippet, no developer required",
                "Keep your domain, your design, your SEO",
                "Two-way sync with your existing CRM if you want to keep one",
                "REST API and Zapier for everything else",
              ].map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--color-teal)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
                  <span className="text-sm text-[var(--color-ink)]">{b}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Code snippet mockup */}
          <div className="md:col-span-5 md:order-1">
            <div className="overflow-hidden rounded-xl border border-[var(--color-navy-deep)] bg-[var(--color-navy-deep)] shadow-[0_30px_80px_-30px_rgba(27,38,54,0.6)]">
              <div className="flex items-center gap-2 border-b border-white/10 bg-[var(--color-navy)]/60 px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" aria-hidden="true" />
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/80" aria-hidden="true" />
                  <span className="h-2.5 w-2.5 rounded-full bg-green-400/80" aria-hidden="true" />
                </div>
                <span className="ml-2 font-mono text-xs text-white/60">your-site.com/book</span>
              </div>
              <pre className="overflow-x-auto p-5 text-xs leading-relaxed text-[var(--color-cream)]/90 md:text-sm">
{`<!-- One-line embed -->
<script
  src="https://cdn.aesthera.io/embed.js"
  data-clinic="your-clinic-id"
  data-theme="light"
  defer>
</script>

<!-- Renders your full booking flow -->
<div id="aesthera-book"></div>`}
              </pre>
            </div>
            <p className="mt-4 text-center text-xs text-[var(--color-ink-muted)]">Bookings flow into Aesthera in real time.</p>
          </div>
        </div>
      </section>

      {/* SECURITY & TRUST — right before pricing so buyers see safe → see price */}
      <section id="security" className="relative overflow-hidden bg-[var(--color-navy-deep)] py-24 text-[var(--color-cream)] md:py-32">
        <div aria-hidden="true" className="absolute inset-0 grid-dots opacity-[0.05]" />
        <div
          aria-hidden="true"
          className="absolute -top-24 -left-24 h-[420px] w-[420px] rounded-full bg-[var(--color-teal)]/15 blur-3xl"
        />

        <div className="container-narrow relative">
          <Reveal>
            <div className="mx-auto max-w-2xl text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-gold)]/40 bg-[var(--color-gold)]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">
                <Lock className="h-3 w-3" strokeWidth={2.5} />
                Built secure · HIPAA-ready
              </div>
              <h2 className="mt-6 text-[var(--color-cream)]">
                Your client data is treated like the medical record it is.
              </h2>
              <div className="rule-gold mx-auto mt-6" />
              <p className="mt-7 text-lg text-[var(--color-cream)]/85">
                Aesthera was built from day one for clinics that handle protected health
                information. Encryption at rest and in transit, two-factor authentication,
                append-only audit logs, automatic logoff, and signed BAAs with every
                infrastructure provider that touches your data.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: <Lock className="h-5 w-5" strokeWidth={2.5} />,
                  title: "Encryption at rest + in transit",
                  body:
                    "AES-256 across Firestore + Cloud Storage. TLS 1.2+ with HSTS preloaded. Sensitive tokens get a second AES-256-GCM layer before they ever touch the database.",
                },
                {
                  icon: <KeyRound className="h-5 w-5" strokeWidth={2.5} />,
                  title: "MFA + automatic logoff",
                  body:
                    "TOTP authenticator + SMS backup. AAL2 enforced on every admin page. 15-minute idle timeout per HIPAA §164.312(a)(2)(iii). Account lockout on 5 failed attempts.",
                },
                {
                  icon: <FileCheck2 className="h-5 w-5" strokeWidth={2.5} />,
                  title: "Append-only audit log",
                  body:
                    "Every write — patient records, charts, appointments, payments — stamped with actor, timestamp, IP, and before/after diff. Security rules deny update + delete on every audit row.",
                },
                {
                  icon: <ServerCog className="h-5 w-5" strokeWidth={2.5} />,
                  title: "HIPAA-eligible infrastructure",
                  body:
                    "Hosted on Google Cloud (Cloud Run + Firestore + Identity Platform). BAA signed with GCP and Twilio; available with Resend and Anthropic. Stripe never sees PHI.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-[var(--color-gold)]/20 bg-white/5 p-6 backdrop-blur-sm"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-gold)]/15 text-[var(--color-gold)]">
                    {item.icon}
                  </div>
                  <h3 className="mt-4 font-display text-base font-bold text-[var(--color-cream)]">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-cream)]/80">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-12 grid gap-6 md:grid-cols-12 md:items-stretch">
              {/* Compliance checklist */}
              <div className="md:col-span-7 rounded-2xl border border-[var(--color-gold)]/30 bg-white/5 p-7 backdrop-blur-sm">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">
                  HIPAA Security Rule · technical safeguards
                </div>
                <ul className="mt-4 space-y-2.5 text-sm text-[var(--color-cream)]/95">
                  {[
                    { spec: "§164.312(a)(2)(i)", label: "Unique user ID per admin" },
                    { spec: "§164.312(a)(2)(iii)", label: "Automatic logoff (15-min idle)" },
                    { spec: "§164.312(a)(2)(iv)", label: "Encryption + decryption (AES-256)" },
                    { spec: "§164.312(b)", label: "Audit controls (append-only audit_log)" },
                    { spec: "§164.312(c)(1)", label: "Integrity controls (immutable signed records)" },
                    { spec: "§164.312(d)", label: "Person/entity authentication (MFA AAL2)" },
                    { spec: "§164.312(e)(1)", label: "Transmission security (TLS 1.2+)" },
                  ].map((row) => (
                    <li key={row.spec} className="flex items-start gap-3">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-gold)]" strokeWidth={3} />
                      <span>
                        <code className="font-mono text-[10px] text-[var(--color-cream)]/60">{row.spec}</code>{" "}
                        {row.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Trust card */}
              <div className="md:col-span-5">
                <div className="flex h-full flex-col rounded-2xl border border-[var(--color-gold)]/30 bg-[var(--color-paper)] p-7 text-[var(--color-ink)] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
                    Where your data lives
                  </div>
                  <h3 className="mt-2 font-display text-lg font-bold text-[var(--color-navy)]">
                    Your data, your control.
                  </h3>
                  <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                    <li className="flex items-start gap-2">
                      <BadgeCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-teal)]" strokeWidth={2.5} />
                      <span><strong>BAA signed</strong> with Aesthera at Growth + Enterprise tiers.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <BadgeCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-teal)]" strokeWidth={2.5} />
                      <span><strong>Per-tenant isolation</strong> — your records never share a row with another clinic.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <BadgeCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-teal)]" strokeWidth={2.5} />
                      <span><strong>Full export anytime</strong> — CSV / PDF on demand. No vendor lock-in.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <BadgeCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-teal)]" strokeWidth={2.5} />
                      <span><strong>30-day data retention</strong> after cancellation, then permanent purge.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <BadgeCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-teal)]" strokeWidth={2.5} />
                      <span><strong>Incident response</strong> — 24-hour breach notification commitment.</span>
                    </li>
                  </ul>
                  <p className="mt-5 text-[11px] text-[var(--color-ink-muted)]">
                    Stripe never sees protected health information. Payment metadata only.
                    Resend &amp; Twilio receive only the email address or phone number plus
                    the message you configure.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>

          <p className="mt-10 text-center text-sm text-[var(--color-cream)]/70">
            Want to see the full security posture, including subprocessor BAA inventory and the audit log? It&apos;s the first thing we walk you through on a 15-min demo.
          </p>
          <div className="mt-6 text-center">
            <BookDemoBtn dataCta="Security · Book demo">See the security posture live</BookDemoBtn>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="bg-[var(--color-cream-deep)] py-24 md:py-32">
        <div className="container-narrow">
          <div className="mx-auto max-w-2xl text-center">
            <div className="tag">Three tiers · Cancel anytime</div>
            <h2 className="mt-5">Pricing that scales with your clinic.</h2>
            <div className="rule-gold mx-auto mt-6" />
            <p className="mt-7 text-lg text-[var(--color-ink-soft)]">
              Per-location pricing, billed monthly. Annual prepay saves 15%. Real human onboarding included on every tier.
            </p>

            {/* Risk-reversal block above the tier cards */}
            <div className="mt-8 inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-full border-2 border-[var(--color-gold)] bg-[var(--color-paper)] px-5 py-2.5 text-sm font-semibold text-[var(--color-navy)] shadow-[0_10px_30px_-10px_rgba(185,143,66,0.4)]">
              <span className="flex items-center gap-1.5">
                <BadgeCheck className="h-4 w-4 text-[var(--color-gold-deep)]" strokeWidth={2.5} />
                14-day free trial
              </span>
              <span className="text-[var(--color-line)]">·</span>
              <span className="flex items-center gap-1.5">
                <BadgeCheck className="h-4 w-4 text-[var(--color-gold-deep)]" strokeWidth={2.5} />
                30-day money-back guarantee
              </span>
              <span className="text-[var(--color-line)]">·</span>
              <span className="flex items-center gap-1.5">
                <BadgeCheck className="h-4 w-4 text-[var(--color-gold-deep)]" strokeWidth={2.5} />
                Cancel anytime · no contracts
              </span>
            </div>
            <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
              Try the platform free for 14 days. If you&apos;re not seeing results in 30, we refund every dollar — no questions, no friction.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {PRICING.map((tier) => (
              <div
                key={tier.name}
                className={`relative flex flex-col rounded-2xl border p-7 ${
                  tier.featured
                    ? "border-2 border-[var(--color-gold)] bg-[var(--color-paper)] shadow-[0_30px_80px_-30px_rgba(185,143,66,0.4)]"
                    : "border-[var(--color-line)] bg-[var(--color-paper)]"
                }`}
              >
                {tier.featured && (
                  <div className="absolute -top-3 left-7 rounded-full bg-[var(--color-gold)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--color-navy-deep)]">
                    Most popular
                  </div>
                )}
                <h3 className="font-display text-xl font-bold text-[var(--color-navy)]">{tier.name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <div className="font-display text-4xl font-bold text-[var(--color-navy)]">{tier.price}</div>
                  <div className="text-sm text-[var(--color-ink-muted)]">{tier.per}</div>
                </div>
                <p className="mt-3 text-[var(--color-ink-soft)]">{tier.description}</p>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{tier.bestFor}</p>

                <ul className="mt-6 flex-1 space-y-3">
                  {tier.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-3">
                      <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--color-teal)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
                      <span className="text-sm text-[var(--color-ink)]">{feat}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  <Link href={tier.href} className={tier.featured ? "btn btn-gold w-full justify-center" : "btn btn-ghost w-full justify-center"}>
                    {tier.cta} <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHITE-GLOVE ONBOARDING — one-time setup add-on */}
      <section id="white-glove" className="bg-[var(--color-cream)] py-20 md:py-28">
        <div className="container-narrow max-w-5xl">
          <Reveal>
            <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-7">
                <div className="tag">White-glove setup · one-time</div>
                <h2 className="mt-5">Skip the setup. We do it for you in 48 hours.</h2>
                <div className="rule-gold mt-6" />
                <p className="mt-6 text-lg text-[var(--color-ink-soft)]">
                  Onboarding the average med spa to a new platform takes 30+ hours of your team&apos;s time spread across two months. We do all of it in 48 hours, hand you the keys, and walk you through everything live. Done by the developer who built Aesthera — not a sales engineer.
                </p>

                <ul className="mt-7 grid gap-3 sm:grid-cols-2">
                  {[
                    "Stripe Connect onboarded · payouts wired",
                    "Twilio number provisioned · SMS templates loaded",
                    "Google Calendar + Reviews + Business Profile linked",
                    "Meta · Instagram · TikTok · X social connections",
                    "5 nurture email workflows pre-loaded",
                    "All locations · providers · services migrated",
                    "Existing client data imported (CSV / API / direct DB)",
                    "1-hour live training session for owner + provider lead",
                    "30 days priority support — direct line to Cory",
                    "HIPAA BAA + security checklist completed",
                  ].map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-gold-deep)]" strokeWidth={3} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="lg:col-span-5">
                <div className="relative overflow-hidden rounded-2xl border-2 border-[var(--color-gold)] bg-gradient-to-br from-[var(--color-paper)] to-[var(--color-cream-deep)] p-7 shadow-[0_30px_80px_-30px_rgba(185,143,66,0.5)]">
                  <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-[var(--color-gold)]/20 blur-2xl" aria-hidden="true" />
                  <div className="relative">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-gold-deep)]">
                      One-time setup fee
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <div className="font-display text-5xl font-bold text-[var(--color-navy)]">$1,500</div>
                      <div className="text-sm text-[var(--color-ink-muted)]">one-time · 48-hour delivery</div>
                    </div>
                    <p className="mt-4 text-sm text-[var(--color-ink-soft)]">
                      Pays for itself the first month — most owners say onboarding cost them a full week of their team&apos;s time. We compress that to two days, and you keep the week.
                    </p>
                    <div className="mt-6 space-y-3">
                      <BookDemoBtn
                        className="btn btn-gold w-full justify-center"
                        dataCta="White-glove · Book a call"
                        withCalendarIcon={false}
                      >
                        Talk to Cory first →
                      </BookDemoBtn>
                      <a
                        href="/api/demo/whiteglove/checkout"
                        className="btn btn-ghost w-full justify-center"
                        data-cta="White-glove · Buy"
                      >
                        Buy onboarding now
                      </a>
                    </div>
                    <ul className="mt-5 space-y-1.5 text-[11px] text-[var(--color-ink-muted)]">
                      <li className="flex items-center gap-1.5">
                        <BadgeCheck className="h-3 w-3 flex-shrink-0 text-[var(--color-gold-deep)]" strokeWidth={2.5} />
                        100% refundable up to kickoff call
                      </li>
                      <li className="flex items-center gap-1.5">
                        <BadgeCheck className="h-3 w-3 flex-shrink-0 text-[var(--color-gold-deep)]" strokeWidth={2.5} />
                        Pairs with the 14-day free trial + 30-day money-back guarantee
                      </li>
                      <li className="flex items-center gap-1.5">
                        <BadgeCheck className="h-3 w-3 flex-shrink-0 text-[var(--color-gold-deep)]" strokeWidth={2.5} />
                        Pairs with any subscription tier including Founding-25
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* EARLY ACCESS DEVELOPER SPECIAL — the irresistible offer */}
      <section id="early-access" className="relative overflow-hidden bg-gradient-to-br from-[var(--color-navy-deep)] via-[var(--color-navy)] to-[var(--color-teal-deep)] py-24 text-[var(--color-cream)] md:py-32">
        <div aria-hidden="true" className="absolute inset-0 grid-dots opacity-[0.06]" />
        <div
          aria-hidden="true"
          className="absolute -top-32 right-0 h-[520px] w-[520px] rounded-full bg-[var(--color-gold)]/20 blur-3xl"
        />

        <div className="container-narrow relative">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-gold)]/40 bg-[var(--color-gold)]/15 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-gold)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-gold)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-gold)]" />
              </span>
              Limited · founding-25 spots
            </div>
            <h2 className="mt-6 text-[var(--color-cream)] md:text-5xl">Early Access Developer Special</h2>
            <p className="mt-6 text-xl text-[var(--color-cream)]/85 md:text-2xl">
              Lock in <span className="font-bold text-[var(--color-gold)]">$99/month for life</span> — that's everything in the Growth tier ($399/mo) at a 75% discount, locked forever.
            </p>
          </div>

          <div className="mx-auto mt-14 max-w-5xl">
            <Reveal>
              <FoundingProgress />
            </Reveal>

            <Reveal delay={140}>
              <div className="mt-8 grid gap-6 md:grid-cols-12 md:items-stretch">
                <div className="md:col-span-7">
                  <div className="h-full rounded-2xl border border-[var(--color-gold)]/30 bg-white/5 p-7 backdrop-blur-sm md:p-9">
                    <div className="font-display text-xl font-bold text-[var(--color-gold)]">What you get</div>
                    <ul className="mt-5 space-y-3">
                      {[
                        "Everything in Growth ($399/mo value) — locked at $99/mo for life",
                        "14-day free trial · 30-day money-back guarantee",
                        "First in line for every new feature",
                        "Direct line to founders (text, Slack, Zoom)",
                        "White-glove onboarding — your data, our hands, no extra fee",
                        "Influence the roadmap — your asks shape v1",
                        "Cancel anytime · keep the lifetime rate as long as you stay",
                      ].map((b) => (
                        <li key={b} className="flex items-start gap-3 text-[var(--color-cream)]/95">
                          <Check className="mt-1 h-4 w-4 flex-shrink-0 text-[var(--color-gold)]" strokeWidth={3} />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-7 rounded-lg border-l-4 border-[var(--color-gold)] bg-white/5 px-5 py-4 text-sm italic text-[var(--color-cream)]/85">
                      &quot;We&apos;re building this with the first 25 clinics, not for them. In return, you get the deepest discount we&apos;ll ever run — for as long as you&apos;re a customer.&quot; — Cory Salisbury, founder
                    </div>
                  </div>
                </div>

                <div className="md:col-span-5">
                  <div className="flex h-full flex-col rounded-2xl border border-[var(--color-gold)]/30 bg-[var(--color-paper)] p-7 text-[var(--color-ink)] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-gold)]">Founding 25 price</div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <div className="font-display text-5xl font-bold text-[var(--color-navy)]">$99</div>
                      <div className="text-sm text-[var(--color-ink-muted)]">/ month for life</div>
                    </div>
                    <div className="mt-1 text-sm text-[var(--color-ink-muted)]">
                      <span className="line-through">$399/mo</span> · 75% off forever
                    </div>
                    <div className="mt-6 space-y-3">
                      <BookDemoBtn className="btn btn-gold w-full justify-center" dataCta="Founding-25 · Claim a spot" withCalendarIcon={false}>
                        Get started — book a call
                      </BookDemoBtn>
                      <Link href="#info" className="btn btn-ghost w-full justify-center" data-cta="Founding-25 · More info">
                        Get more info first
                      </Link>
                    </div>
                    <ul className="mt-6 space-y-2 text-xs text-[var(--color-ink-muted)]">
                      <li className="flex items-center gap-2"><BadgeCheck className="h-3.5 w-3.5 text-[var(--color-teal)]" strokeWidth={2.5} /> 14-day free trial · no credit card to start</li>
                      <li className="flex items-center gap-2"><BadgeCheck className="h-3.5 w-3.5 text-[var(--color-teal)]" strokeWidth={2.5} /> 30-day money-back guarantee</li>
                      <li className="flex items-center gap-2"><BadgeCheck className="h-3.5 w-3.5 text-[var(--color-teal)]" strokeWidth={2.5} /> No setup fee · cancel anytime</li>
                      <li className="flex items-center gap-2"><BadgeCheck className="h-3.5 w-3.5 text-[var(--color-teal)]" strokeWidth={2.5} /> Live within 48 hours of signup</li>
                      <li className="flex items-center gap-2"><BadgeCheck className="h-3.5 w-3.5 text-[var(--color-teal)]" strokeWidth={2.5} /> HIPAA BAA included</li>
                    </ul>
                  </div>
                </div>
              </div>
            </Reveal>

            <p className="mt-6 text-center text-sm text-[var(--color-cream)]/70">
              Once 25 founding clinics are signed, this offer closes — for good. Standard pricing resumes for everyone after.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 md:py-32">
        <div className="container-narrow max-w-3xl">
          <div className="tag">Common questions</div>
          <h2 className="mt-5">What clinic owners ask before they sign.</h2>
          <div className="rule-gold mt-6" />
          <div className="mt-12 divide-y divide-[var(--color-line)]">
            {FAQS.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-display text-lg font-bold text-[var(--color-navy)]">
                  <span>{f.q}</span>
                  <span aria-hidden="true" className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-teal)]/10 text-[var(--color-teal)] transition group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[var(--color-ink-soft)]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* MORE INFO FORM */}
      <section id="info" className="bg-[var(--color-cream-deep)] py-24 md:py-32">
        <div className="container-narrow max-w-2xl">
          <div className="text-center">
            <div className="tag mx-auto justify-center">Not ready for a call yet?</div>
            <h2 className="mt-5">Get the full picture by email.</h2>
            <div className="rule-gold mx-auto mt-6" />
            <p className="mt-7 text-lg text-[var(--color-ink-soft)]">
              Drop your details and we&apos;ll send a short, no-pressure email series — one platform that consolidates the seven you&apos;re paying for now, with a real walkthrough of each module. Unsubscribe with one click any time.
            </p>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {[
              { t: "Day 0", l: "How seven tools become one workspace" },
              { t: "Day 2", l: "What clinical charting + photos + consents look like" },
              { t: "Day 4", l: "AI marketing that runs while your team sleeps" },
            ].map((s) => (
              <div key={s.t} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4 text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-gold-deep)]">{s.t}</div>
                <div className="mt-2 text-sm font-semibold text-[var(--color-navy)]">{s.l}</div>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-7 shadow-[0_30px_80px_-30px_rgba(46,64,87,0.3)] md:p-10">
            <DemoRequestForm />
          </div>

          <p className="mt-6 text-center text-sm text-[var(--color-ink-muted)]">
            Want to talk instead?{" "}
            <BookDemoBtn
              className="font-semibold text-[var(--color-teal)] hover:underline"
              dataCta="Info section · Book demo"
              withCalendarIcon={false}
              withArrow={false}
            >
              Book a 15-min demo →
            </BookDemoBtn>
            {" · "}or text{" "}
            <a href="tel:8012450511" className="font-semibold text-[var(--color-teal)] hover:underline">801-245-0511</a>
          </p>
        </div>
      </section>

      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "SoftwareApplication",
                name: "Aesthera",
                alternateName: "Aesthera · MedSpa Management Software",
                applicationCategory: "BusinessApplication",
                operatingSystem: "Web",
                description:
                  "Aesthera is MedSpa management software for med spas, aesthetic clinics, IV lounges, and wellness studios. Replaces booking, charting, payments, marketing, and financials in one platform.",
                offers: {
                  "@type": "AggregateOffer",
                  lowPrice: "99",
                  highPrice: "899",
                  priceCurrency: "USD",
                  offerCount: 4,
                },
                provider: {
                  "@type": "Organization",
                  name: "Aesthera",
                  url: process.env.NEXT_PUBLIC_SITE_URL || "/",
                },
              },
              {
                "@type": "FAQPage",
                mainEntity: FAQS.map((f) => ({
                  "@type": "Question",
                  name: f.q,
                  acceptedAnswer: { "@type": "Answer", text: f.a },
                })),
              },
            ],
          }),
        }}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline mockup components — sketch the dashboard look without shipping the real app.
// ─────────────────────────────────────────────────────────────────────────────

function DashboardMockup({ role }: { role: string }) {
  if (role === "For Owners") {
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] shadow-[0_30px_80px_-30px_rgba(46,64,87,0.4)]">
        <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-cream-deep)]/50 px-5 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-ink-soft)]">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--color-navy)] text-[10px] font-bold text-[var(--color-gold)]">A</span>
            Owner Dashboard
          </div>
          <div className="rounded border border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1 text-xs text-[var(--color-ink-soft)]">All Locations ▾</div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-[var(--color-line)]">
          {[
            { l: "Revenue (MTD)", v: "$184k", d: "+12%", up: true },
            { l: "Capacity", v: "78%", d: "+4pp", up: true },
            { l: "Ad spend ROAS", v: "4.1x", d: "+0.6", up: true },
          ].map((k) => (
            <div key={k.l} className="p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{k.l}</div>
              <div className="mt-1 font-display text-xl font-bold text-[var(--color-navy)]">{k.v}</div>
              <div className={`text-[11px] font-semibold ${k.up ? "text-[var(--color-teal)]" : "text-red-500"}`}>{k.d}</div>
            </div>
          ))}
        </div>
        <div className="border-t border-[var(--color-line)] p-5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">Revenue by location · last 30 days</div>
          <div className="mt-3 space-y-2">
            {[
              { name: "Park City", val: 78, dollar: "$48.2k" },
              { name: "Salt Lake", val: 92, dollar: "$56.7k" },
              { name: "Provo", val: 58, dollar: "$35.9k" },
              { name: "Lehi", val: 71, dollar: "$43.6k" },
            ].map((b) => (
              <div key={b.name} className="flex items-center gap-3 text-xs">
                <div className="w-20 flex-shrink-0 text-[var(--color-ink-soft)]">{b.name}</div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-cream-deep)]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[var(--color-teal)] to-[var(--color-gold)]" style={{ width: `${b.val}%` }} />
                </div>
                <div className="w-14 flex-shrink-0 text-right font-mono font-semibold text-[var(--color-navy)]">{b.dollar}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (role === "For Providers") {
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] shadow-[0_30px_80px_-30px_rgba(46,64,87,0.4)]">
        <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-cream-deep)]/50 px-5 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-ink-soft)]">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-teal)] text-[10px] font-bold text-white">SR</span>
            Sarah R. · Today
          </div>
          <div className="text-xs text-[var(--color-ink-muted)]">11:00 AM · Botox 30u</div>
        </div>
        <div className="border-b border-[var(--color-line)] bg-gradient-to-br from-[var(--color-cream)] to-[var(--color-cream-deep)] p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Before / after photos
            </div>
            <span className="rounded-full bg-[var(--color-teal)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--color-teal-deep)]">
              HIPAA · private to chart
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-[var(--color-ink-soft)]">
            Capture standardized before/after pairs from any phone, mark areas of treatment, and gate visibility per chart. No iPhone camera roll, no AirDrop, no orphaned images. Built-in consent on first capture.
          </p>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-[var(--color-ink-muted)]">
            <span className="flex h-1.5 w-1.5 rounded-full bg-[var(--color-teal)]" />
            Standard pose guides
            <span className="ml-2 flex h-1.5 w-1.5 rounded-full bg-[var(--color-gold)]" />
            Annotation overlay
            <span className="ml-2 flex h-1.5 w-1.5 rounded-full bg-[var(--color-navy)]" />
            Side-by-side compare
          </div>
        </div>
        <div className="border-t border-[var(--color-line)] p-5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">SOAP · last visit</div>
          <div className="mt-2 space-y-1.5 font-mono text-[11px] text-[var(--color-ink-soft)]">
            <div><span className="font-bold text-[var(--color-teal)]">S:</span> Returning for maintenance Botox. Wedding in 4 weeks.</div>
            <div><span className="font-bold text-[var(--color-teal)]">O:</span> Mild glabellar lines, dynamic. No allergies noted.</div>
            <div><span className="font-bold text-[var(--color-teal)]">A:</span> Good candidate, prior plan effective.</div>
            <div><span className="font-bold text-[var(--color-teal)]">P:</span> 30u glabellar + 8u crow's feet. Follow-up 2 wks.</div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="flex-1 rounded bg-[var(--color-teal)] px-3 py-1.5 text-xs font-semibold text-white">✓ Sign & Save</button>
            <button className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)]">Edit</button>
          </div>
        </div>
      </div>
    );
  }

  // For Clients
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] shadow-[0_30px_80px_-30px_rgba(46,64,87,0.4)]">
      <div className="flex items-center gap-3 border-b border-[var(--color-line)] bg-gradient-to-r from-[var(--color-navy)] to-[var(--color-teal)] px-5 py-4 text-[var(--color-cream)]">
        <div className="h-9 w-9 rounded-full bg-[var(--color-gold)]/30 ring-2 ring-[var(--color-gold)]/50" />
        <div>
          <div className="text-xs text-[var(--color-cream)]/70">Welcome back</div>
          <div className="font-semibold">Jessica P.</div>
        </div>
      </div>
      <div className="space-y-3 p-5">
        <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)]/50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-gold)]">Your next visit</div>
          <div className="mt-1 text-sm font-semibold text-[var(--color-navy)]">Botox · Sarah R.</div>
          <div className="text-xs text-[var(--color-ink-soft)]">Tue Apr 30 · 11:00 AM · Park City</div>
          <div className="mt-2 flex gap-2">
            <button className="rounded bg-[var(--color-teal)] px-2.5 py-1 text-[11px] font-semibold text-white">Reschedule</button>
            <button className="rounded border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-ink-soft)]">Add to calendar</button>
          </div>
        </div>
        <div className="rounded-lg border-l-4 border-[var(--color-gold)] bg-[var(--color-paper)] p-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-gold)]">✦ Recommended for you</div>
          <div className="mt-1 text-sm text-[var(--color-ink)]">Add a 6-week skincare follow-up — based on your recent visit, here's what Sarah suggests.</div>
          <button className="mt-2 text-[11px] font-semibold text-[var(--color-teal)] hover:underline">Book follow-up →</button>
        </div>
      </div>
    </div>
  );
}

function MultiLocationMockup() {
  const locations = [
    { name: "Park City", rev: "$48.2k", cap: 82, color: "from-[#07667a] to-[#b98f42]" },
    { name: "Salt Lake", rev: "$56.7k", cap: 91, color: "from-[#b98f42] to-[#07667a]" },
    { name: "Provo", rev: "$35.9k", cap: 64, color: "from-[#07667a] to-[#04738c]" },
    { name: "Lehi", rev: "$43.6k", cap: 73, color: "from-[#b98f42] to-[#d6a85f]" },
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-gold)]/30 bg-[var(--color-paper)] text-[var(--color-ink)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-cream-deep)] px-5 py-3">
        <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-navy)]">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--color-navy)] text-[10px] font-bold text-[var(--color-gold)]">A</span>
          Multi-location · April 2026
        </div>
        <div className="rounded border border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1 text-xs">All 4 Locations ▾</div>
      </div>
      <div className="grid grid-cols-4 divide-x divide-[var(--color-line)] border-b border-[var(--color-line)]">
        {[
          { l: "Combined revenue", v: "$184k" },
          { l: "Avg capacity", v: "78%" },
          { l: "Ad spend", v: "$22.4k" },
          { l: "ROAS", v: "4.1x" },
        ].map((k) => (
          <div key={k.l} className="p-3">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">{k.l}</div>
            <div className="mt-1 font-display text-base font-bold text-[var(--color-navy)] md:text-lg">{k.v}</div>
          </div>
        ))}
      </div>
      <div className="space-y-3 p-5">
        {locations.map((loc) => (
          <div key={loc.name} className="flex items-center gap-4 rounded-lg border border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 p-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--color-navy)] text-xs font-bold text-[var(--color-gold)]">
              {loc.name.split(" ").map((w) => w[0]).join("")}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[var(--color-navy)]">{loc.name}</span>
                <span className="font-mono font-semibold text-[var(--color-ink)]">{loc.rev}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
                <div className={`h-full rounded-full bg-gradient-to-r ${loc.color}`} style={{ width: `${loc.cap}%` }} />
              </div>
              <div className="mt-1 text-[10px] text-[var(--color-ink-muted)]">Capacity {loc.cap}%</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
