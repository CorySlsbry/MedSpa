"use client";

/**
 * Founding-25 progress meter. The number is hand-set (we'll wire it
 * to a Firestore counter post-launch), animated bar fills on view.
 */

import { useEffect, useRef, useState } from "react";

const CLAIMED = 6; // hand-set; replace with real count once we have one
const TOTAL = 25;

export default function FoundingProgress() {
  const [pct, setPct] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = (CLAIMED / TOTAL) * 100;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const start = performance.now();
            const dur = 1400;
            const tick = (now: number) => {
              const t = Math.min(1, (now - start) / dur);
              const eased = 1 - Math.pow(1 - t, 3);
              setPct(target * eased);
              if (t < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const remaining = TOTAL - CLAIMED;

  return (
    <div ref={ref} className="rounded-2xl border border-[var(--color-gold)]/30 bg-gradient-to-br from-[var(--color-navy-deep)] to-[var(--color-teal-deep)] p-6 text-[var(--color-cream)] md:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-gold)]/40 bg-[var(--color-gold)]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-gold)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-gold)] animate-glow-dot" />
          Founding-25
        </span>
        <span className="text-xs text-[var(--color-cream)]/70">
          $99/mo for life · everything in Enterprise · price-locked while your account stays active
        </span>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <div className="font-display text-3xl font-bold tracking-tight md:text-4xl">
            {CLAIMED} <span className="text-[var(--color-cream)]/40">/</span> {TOTAL}
          </div>
          <div className="mt-1 text-xs text-[var(--color-cream)]/60">Spots claimed</div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold text-[var(--color-gold)] md:text-3xl">
            {remaining}
          </div>
          <div className="mt-1 text-xs text-[var(--color-cream)]/60">Remaining</div>
        </div>
      </div>

      <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--color-gold)] to-[var(--color-gold-soft)]"
          style={{ width: `${pct}%`, transition: "width 0.05s linear" }}
        />
      </div>

      <div className="mt-3 text-xs text-[var(--color-cream)]/70">
        Once 25 are claimed, the offer closes — permanently. Future Aesthera price changes never apply to founding accounts.
      </div>
    </div>
  );
}
