"use client";

/**
 * Reveal — wraps a child in a div that fades + slides up when scrolled into view.
 *
 * Honors prefers-reduced-motion (handled in globals.css for the .reveal class).
 * Uses native IntersectionObserver, no JS animation library needed.
 *
 * Usage:
 *   <Reveal><h2>...</h2></Reveal>
 *   <Reveal delay={120}><p>...</p></Reveal>
 */

import { useEffect, useRef, type ReactNode } from "react";

export default function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in-view");
            obs.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const TagComp = Tag as unknown as React.ElementType;
  return (
    <TagComp
      ref={ref}
      className={`reveal ${className}`}
      style={{ ["--reveal-delay" as string]: `${delay}ms` }}
    >
      {children}
    </TagComp>
  );
}
