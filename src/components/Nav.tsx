import Link from "next/link";
import { BookDemoBtn } from "./marketing/HeroBookCta";

export default function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[var(--color-navy-deep)]/95 text-[var(--color-cream)] backdrop-blur supports-[backdrop-filter]:bg-[var(--color-navy-deep)]/85">
      <div className="container-narrow flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Aesthera — home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-gold)] font-display text-base font-bold text-[var(--color-navy-deep)]">
            A
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            Aesthera
          </span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm md:flex" aria-label="Primary">
          <Link href="/#pricing" className="text-[var(--color-cream)]/80 transition hover:text-[var(--color-cream)]">
            Pricing
          </Link>
          <Link href="/#early-access" className="text-[var(--color-cream)]/80 transition hover:text-[var(--color-cream)]">
            Early access
          </Link>
          <BookDemoBtn
            className="text-[var(--color-cream)]/80 transition hover:text-[var(--color-cream)]"
            dataCta="Nav · Book demo"
            withCalendarIcon={false}
            withArrow={false}
          >
            Book a demo
          </BookDemoBtn>
          <Link href="/sign-in" className="text-[var(--color-cream)]/80 transition hover:text-[var(--color-cream)]">
            Sign in
          </Link>
          <BookDemoBtn
            className="rounded-lg bg-[var(--color-gold)] px-4 py-2 font-semibold text-[var(--color-navy-deep)] transition hover:opacity-90"
            dataCta="Nav · Get started"
            withCalendarIcon={false}
            withArrow={false}
          >
            Get started
          </BookDemoBtn>
        </nav>

        <BookDemoBtn
          className="rounded-lg bg-[var(--color-gold)] px-3 py-1.5 text-sm font-semibold text-[var(--color-navy-deep)] md:hidden"
          dataCta="Nav mobile · Get started"
          withCalendarIcon={false}
          withArrow={false}
        >
          Get started
        </BookDemoBtn>
      </div>
    </header>
  );
}
