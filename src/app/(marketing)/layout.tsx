import type { ReactNode } from "react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import AnalyticsTracker from "@/components/marketing/AnalyticsTracker";
import { DemoBookingPortal } from "@/components/marketing/HeroBookCta";

/**
 * Marketing layout — wraps the public-facing landing site with Nav + Footer.
 * Admin and portal routes opt out of this by living outside the (marketing)
 * group.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-[var(--color-ink)] focus:px-4 focus:py-2 focus:text-[var(--color-cream)]"
      >
        Skip to content
      </a>
      <div className="flex min-h-screen flex-col bg-[var(--color-cream)]">
        <Nav />
        <main id="main" className="flex-1">{children}</main>
        <Footer />
      </div>
      <AnalyticsTracker />
      <DemoBookingPortal />
    </>
  );
}
