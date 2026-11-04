"use client";

/**
 * Booking-modal kit.
 *
 *   <DemoBookingPortal />  — render ONCE at page/layout level. Mounts the
 *                            BookingModal and listens for a CustomEvent.
 *   <BookDemoBtn>...</BookDemoBtn>  — drop-in button replacement for any
 *                            "request a demo" / "book a call" CTA. Fires
 *                            the global event on click.
 *
 * Using a custom event (rather than React context) keeps the buttons
 * decoupled — they don't need to be inside a provider, and the page
 * itself can stay a server component.
 */

import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, ArrowRight } from "lucide-react";
import BookingModal from "./BookingModal";

const EVENT_NAME = "aesthera:open-booking";

export function DemoBookingPortal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(EVENT_NAME, onOpen);
    return () => window.removeEventListener(EVENT_NAME, onOpen);
  }, []);
  return <BookingModal open={open} onClose={() => setOpen(false)} />;
}

export function BookDemoBtn({
  children,
  className = "btn btn-gold",
  dataCta = "Book demo",
  withCalendarIcon = true,
  withArrow = true,
}: {
  children?: ReactNode;
  className?: string;
  dataCta?: string;
  withCalendarIcon?: boolean;
  withArrow?: boolean;
}) {
  return (
    <button
      type="button"
      className={className}
      data-cta={dataCta}
      onClick={() => window.dispatchEvent(new CustomEvent(EVENT_NAME))}
    >
      {withCalendarIcon && <CalendarDays className="h-4 w-4" strokeWidth={2.5} />}
      {children ?? "Book a 15-min demo"}
      {withArrow && <ArrowRight className="h-4 w-4" strokeWidth={2.5} />}
    </button>
  );
}

// Default export for the hero-specific use, kept for backward compat.
export default function HeroBookCta({ label = "Book a 15-min demo" }: { label?: string }) {
  return <BookDemoBtn dataCta="Hero · Book a demo">{label}</BookDemoBtn>;
}
