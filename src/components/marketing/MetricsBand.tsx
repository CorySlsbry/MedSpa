"use client";

/**
 * Forward-looking metrics band. NOT real customer numbers — these are
 * aspirational "what the platform handles" framings that double as
 * design posture (premium, multi-location, AI-native, real-time).
 *
 * Values that are clearly product capabilities, not customer counts,
 * to stay honest while we're pre-customer.
 */

import { useEffect, useRef, useState } from "react";

const METRICS = [
  { value: 7, suffix: " tools", label: "Replaced by one platform" },
  { value: 1.4, suffix: "s", label: "Average AI SOAP draft", decimals: 1 },
  { value: 99.9, suffix: "%", label: "Cloud Run availability", decimals: 1 },
  { value: 48, suffix: " hrs", label: "From signup to first booking" },
];

function useCounter(target: number, decimals = 0, durationMs = 1400) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const start = performance.now();
            const tick = (now: number) => {
              const t = Math.min(1, (now - start) / durationMs);
              const eased = 1 - Math.pow(1 - t, 3);
              setVal(target * eased);
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
  }, [target, durationMs]);

  return { ref, display: val.toFixed(decimals) };
}

function Metric({ value, suffix, label, decimals = 0 }: { value: number; suffix: string; label: string; decimals?: number }) {
  const { ref, display } = useCounter(value, decimals);
  return (
    <div className="text-center">
      <div className="font-display text-4xl font-bold tracking-tight text-[var(--color-cream)] md:text-5xl">
        <span ref={ref}>{display}</span>
        <span className="text-[var(--color-gold)]">{suffix}</span>
      </div>
      <div className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--color-cream)]/60">{label}</div>
    </div>
  );
}

export default function MetricsBand() {
  return (
    <div className="container-narrow">
      <div className="grid grid-cols-2 gap-12 md:grid-cols-4">
        {METRICS.map((m) => (
          <Metric key={m.label} {...m} />
        ))}
      </div>
    </div>
  );
}
