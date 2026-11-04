"use client";

/**
 * "Seven tools → one platform" visual.
 *
 * Left side: 7 tool cards positioned around a dotted boundary, each
 * slightly rotated for a chaotic-desk feel. Right side: a clean Aesthera
 * dashboard card that "absorbs" them. Connecting lines drawn in SVG.
 *
 * Pure CSS animation (gentle pulse on the lines). No external deps.
 */

import { Calendar, ClipboardList, Camera, Mail, Receipt, Megaphone, Star } from "lucide-react";

const TOOLS = [
  { Icon: Calendar, label: "Booking", sub: "Mindbody / Boulevard" },
  { Icon: ClipboardList, label: "Charting", sub: "Paper · spreadsheet · EMR" },
  { Icon: Camera, label: "Photos", sub: "iPhone camera roll" },
  { Icon: Mail, label: "Marketing", sub: "Mailchimp / Klaviyo" },
  { Icon: Receipt, label: "Bookkeeping", sub: "QuickBooks" },
  { Icon: Megaphone, label: "Ads", sub: "Meta · Google" },
  { Icon: Star, label: "Reviews", sub: "Birdeye · GMB" },
];

export default function SevenToOne() {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-2">
      {/* Tool chaos */}
      <div className="relative">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TOOLS.map((t, i) => (
            <div
              key={t.label}
              className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-3 transition hover:-translate-y-0.5 hover:shadow-sm"
              style={{
                transform: `rotate(${(i % 2 === 0 ? -1 : 1) * (1 + (i % 3))}deg)`,
              }}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-cream-deep)] text-[var(--color-ink-muted)]">
                  <t.Icon className="h-3.5 w-3.5" strokeWidth={2} />
                </div>
                <div className="text-xs font-semibold text-[var(--color-navy)]">{t.label}</div>
              </div>
              <div className="mt-1 text-[10px] text-[var(--color-ink-muted)]">{t.sub}</div>
            </div>
          ))}
          <div className="hidden rounded-xl border border-dashed border-[var(--color-line)] bg-transparent p-3 sm:block">
            <div className="text-[10px] uppercase tracking-widest text-[var(--color-ink-muted)]">+ a few more</div>
            <div className="mt-1 text-[10px] text-[var(--color-ink-muted)]">depending on the clinic</div>
          </div>
        </div>
      </div>

      {/* Arrow / fusion → Aesthera */}
      <div className="relative">
        {/* Arrow on small screens */}
        <div className="mb-4 flex items-center justify-center text-[var(--color-gold)] lg:hidden">
          <svg viewBox="0 0 80 24" className="h-6 w-20" fill="none">
            <path d="M0 12 L70 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M62 4 L72 12 L62 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>

        <div className="browser-chrome relative overflow-hidden">
          <div className="border-b border-[var(--color-line)] bg-[var(--color-cream-deep)]/60 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#ED6A5E]" />
              <span className="h-2 w-2 rounded-full bg-[#F4BF4F]" />
              <span className="h-2 w-2 rounded-full bg-[#62C554]" />
              <span className="ml-2 font-mono text-[10px] tracking-tight text-[var(--color-ink-muted)]">aesthera.io · one tab</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 p-4">
            {[
              { l: "Booking", v: "342 this week", t: "var(--color-teal)" },
              { l: "Charts signed", v: "89", t: "var(--color-gold-deep)" },
              { l: "Photos", v: "1,204", t: "var(--color-teal)" },
              { l: "Email opens", v: "62%", t: "var(--color-gold-deep)" },
              { l: "Revenue", v: "$84k", t: "var(--color-teal)" },
              { l: "Ad ROAS", v: "4.1x", t: "var(--color-gold-deep)" },
            ].map((row) => (
              <div key={row.l} className="rounded-md border border-[var(--color-line)] bg-white p-2.5">
                <div className="text-[8px] font-bold uppercase tracking-widest text-[var(--color-ink-muted)]">{row.l}</div>
                <div className="mt-0.5 font-display text-base font-bold" style={{ color: row.t as string }}>{row.v}</div>
              </div>
            ))}
          </div>

          <div className="border-t border-[var(--color-line)] bg-[var(--color-cream)] px-4 py-2 font-mono text-[10px] text-[var(--color-ink-muted)]">
            One login · one source of truth · one number to call when something breaks.
          </div>
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-[var(--color-gold)]/30 blur-2xl animate-float-soft"
        />
      </div>
    </div>
  );
}
