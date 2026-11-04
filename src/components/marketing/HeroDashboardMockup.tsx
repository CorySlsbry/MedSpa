"use client";

/**
 * Hero dashboard mockup — pure SVG, no images.
 *
 * Cycles between three role views (Owner / Provider / Client) every ~5s
 * with a soft cross-fade. Floating gold sparkle + KPI cards stagger-pulse
 * to give the hero a "live, working software" feel without any real
 * tenant data leaking.
 *
 * Designed mobile-first: scales fluidly via viewBox. Honors
 * prefers-reduced-motion (set in globals.css).
 */

import { useEffect, useState } from "react";

type View = "owner" | "provider" | "client";
const VIEWS: View[] = ["owner", "provider", "client"];

const VIEW_LABEL: Record<View, string> = {
  owner: "Owner · Dashboard",
  provider: "Provider · Today",
  client: "Client · Booking",
};

export default function HeroDashboardMockup() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % VIEWS.length), 5500);
    return () => clearInterval(id);
  }, []);

  const current = VIEWS[idx];

  return (
    <div className="relative">
      {/* Floating sparkle accents */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-6 h-24 w-24 rounded-full bg-[var(--color-gold)]/40 blur-2xl animate-float-soft"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-10 -left-8 h-32 w-32 rounded-full bg-[var(--color-teal)]/40 blur-2xl animate-drift-orb"
      />

      {/* Browser frame */}
      <div className="browser-chrome relative overflow-hidden">
        {/* Window controls bar */}
        <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-cream-deep)]/60 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ED6A5E]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#F4BF4F]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#62C554]" />
          </div>
          <div className="font-mono text-[10px] tracking-tight text-[var(--color-ink-muted)]">
            aesthera.io/{current}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-gold)] animate-glow-dot" />
            <span className="text-[10px] font-semibold tracking-wide text-[var(--color-ink-muted)]">
              {VIEW_LABEL[current]}
            </span>
          </div>
        </div>

        {/* View viewport */}
        <div className="relative h-[360px] overflow-hidden md:h-[420px]">
          <OwnerView active={current === "owner"} />
          <ProviderView active={current === "provider"} />
          <ClientView active={current === "client"} />
        </div>
      </div>

      {/* View tabs (cosmetic) */}
      <div className="mt-4 flex justify-center gap-2">
        {VIEWS.map((v, i) => (
          <button
            key={v}
            type="button"
            onClick={() => setIdx(i)}
            className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] transition ${
              v === current
                ? "bg-[var(--color-gold)] text-[var(--color-navy-deep)]"
                : "bg-white/10 text-[var(--color-cream)]/70 hover:bg-white/20 hover:text-[var(--color-cream)]"
            }`}
            aria-label={`Show ${v} view`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

function FadeFrame({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 transition-opacity duration-700 ease-out"
      style={{ opacity: active ? 1 : 0, pointerEvents: active ? "auto" : "none" }}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

function OwnerView({ active }: { active: boolean }) {
  return (
    <FadeFrame active={active}>
      <div className="grid h-full grid-cols-12 gap-2.5 bg-white p-4">
        {/* Sidebar */}
        <div className="col-span-3 flex flex-col gap-1.5 rounded-md bg-[var(--color-cream)] p-2.5">
          <div className="mb-2 flex items-center gap-1.5">
            <div className="h-5 w-5 rounded bg-[var(--color-navy-deep)]" />
            <div className="h-2 w-12 rounded bg-[var(--color-ink-muted)]/30" />
          </div>
          {["Dashboard", "Locations", "Providers", "Services", "Clients", "Marketing", "Reports", "Billing"].map((l, i) => (
            <div
              key={l}
              className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[9px] ${
                i === 0 ? "bg-[var(--color-navy-deep)] font-semibold text-[var(--color-cream)]" : "text-[var(--color-ink-muted)]"
              }`}
            >
              <span className={`h-1 w-1 rounded-full ${i === 0 ? "bg-[var(--color-gold)]" : "bg-[var(--color-line)]"}`} />
              {l}
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="col-span-9 flex flex-col gap-2.5">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[8px] font-bold uppercase tracking-widest text-[var(--color-teal)]">Owner Portal</div>
              <div className="mt-0.5 font-display text-base font-bold text-[var(--color-navy)]">Aesthera · This week</div>
            </div>
            <div className="rounded-full bg-emerald-100 px-2 py-0.5 text-[8px] font-bold text-emerald-800">+18% MoM</div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Revenue", val: "$84,210", delta: "+12%" },
              { label: "Bookings", val: "342", delta: "+9%" },
              { label: "New clients", val: "47", delta: "+22%" },
              { label: "Capacity", val: "78%", delta: "+4pt" },
            ].map((k, i) => (
              <div
                key={k.label}
                className="rounded-md border border-[var(--color-line)] bg-white p-2 transition"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <div className="text-[8px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">{k.label}</div>
                <div className="mt-1 font-display text-[15px] font-bold text-[var(--color-navy)]">{k.val}</div>
                <div className="text-[8px] font-semibold text-emerald-700">{k.delta}</div>
              </div>
            ))}
          </div>

          {/* Bookings-by-day stacked bars */}
          <div className="flex-1 rounded-md border border-[var(--color-line)] bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-ink-muted)]">Bookings by day</div>
              <div className="flex items-center gap-3 text-[8px] text-[var(--color-ink-muted)]">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-teal)]" />Booked</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[var(--color-gold)]" />Walk-in</span>
              </div>
            </div>
            <svg viewBox="0 0 280 80" className="h-full w-full" preserveAspectRatio="none">
              {[34, 48, 39, 52, 67, 71, 28].map((booked, i) => {
                const walkin = Math.round(booked * 0.18);
                const x = 12 + i * 38;
                return (
                  <g key={i}>
                    <rect x={x} y={80 - booked} width={20} height={booked} fill="#07667A" rx={2}>
                      <animate attributeName="height" from={0} to={booked} dur="0.9s" begin={`${i * 0.08}s`} fill="freeze" />
                      <animate attributeName="y" from={80} to={80 - booked} dur="0.9s" begin={`${i * 0.08}s`} fill="freeze" />
                    </rect>
                    <rect x={x} y={80 - booked - walkin} width={20} height={walkin} fill="#b98f42" rx={2}>
                      <animate attributeName="height" from={0} to={walkin} dur="0.9s" begin={`${i * 0.08 + 0.5}s`} fill="freeze" />
                      <animate attributeName="y" from={80 - booked} to={80 - booked - walkin} dur="0.9s" begin={`${i * 0.08 + 0.5}s`} fill="freeze" />
                    </rect>
                    <text x={x + 10} y={80 - booked - walkin - 4} textAnchor="middle" fontSize="7" fill="#4a5568" fontWeight="600">
                      {booked + walkin}
                    </text>
                  </g>
                );
              })}
              {/* Day labels */}
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <text key={i} x={22 + i * 38} y={92} fontSize="7" textAnchor="middle" fill="#4a5568">
                  {d}
                </text>
              ))}
            </svg>
          </div>
        </div>
      </div>
    </FadeFrame>
  );
}

function ProviderView({ active }: { active: boolean }) {
  return (
    <FadeFrame active={active}>
      <div className="grid h-full grid-cols-12 gap-2.5 bg-white p-4">
        {/* Schedule */}
        <div className="col-span-5 rounded-md border border-[var(--color-line)] bg-[var(--color-cream)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-teal)]">Today</div>
            <div className="text-[8px] text-[var(--color-ink-muted)]">Tue · May 5</div>
          </div>
          {[
            { t: "9:00", svc: "Botox · Glabella", c: "Sarah K.", color: "#07667A", chart: true },
            { t: "10:30", svc: "Hydrafacial", c: "Maya R.", color: "#b98f42", chart: false },
            { t: "12:00", svc: "Lip filler · 1mL", c: "Ava P.", color: "#07667A", chart: false },
            { t: "2:00", svc: "Microneedling", c: "Eli J.", color: "#8d4e04", chart: false },
            { t: "3:30", svc: "PRP scalp", c: "Tyler V.", color: "#07667A", chart: false },
          ].map((row, i) => (
            <div
              key={i}
              className="mb-1 flex items-center gap-2 rounded border-l-2 bg-white p-1.5"
              style={{ borderLeftColor: row.color }}
            >
              <div className="font-mono text-[9px] font-bold text-[var(--color-navy)]">{row.t}</div>
              <div className="flex-1">
                <div className="text-[10px] font-semibold text-[var(--color-navy)]">{row.svc}</div>
                <div className="text-[8px] text-[var(--color-ink-muted)]">{row.c}</div>
              </div>
              {row.chart && (
                <div className="rounded-sm bg-[var(--color-gold)]/15 px-1 py-0.5 text-[7px] font-bold uppercase text-[var(--color-gold-deep)]">chart</div>
              )}
            </div>
          ))}
        </div>

        {/* SOAP editor */}
        <div className="col-span-7 flex flex-col rounded-md border border-[var(--color-gold)]/40 bg-gradient-to-br from-white to-[var(--color-cream)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-gold-deep)]">AI SOAP draft</div>
              <div className="font-display text-xs font-bold text-[var(--color-navy)]">Sarah K. · Botox · Glabella</div>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-[var(--color-gold)]/20 px-2 py-0.5">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-gold-deep)] animate-glow-dot" />
              <span className="text-[8px] font-bold text-[var(--color-gold-deep)]">Generated · 1.4s</span>
            </div>
          </div>

          {[
            { k: "S", t: "Pt c/o moderate glabellar furrows on dynamic frown. No prior Botox. No allergies. No anticoagulants." },
            { k: "O", t: "Forehead/glabella inspected. Skin intact, no infection. Symmetric corrugator/procerus contraction." },
            { k: "A", t: "Glabellar rhytides, Class II — appropriate candidate for neuromodulator." },
            { k: "P", t: "Botox 20U glabella per CKMP standard pattern. Aftercare counseled. F/U 2wk for touch-up if needed." },
          ].map((sec) => (
            <div key={sec.k} className="mb-1.5 flex gap-2">
              <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-[var(--color-navy-deep)] font-display text-[9px] font-bold text-[var(--color-gold)]">
                {sec.k}
              </div>
              <div className="text-[8.5px] leading-snug text-[var(--color-ink-soft)]">{sec.t}</div>
            </div>
          ))}

          <div className="mt-auto flex items-center gap-2 border-t border-[var(--color-line)] pt-2">
            <div className="rounded bg-[var(--color-gold)] px-2 py-1 text-[9px] font-bold text-[var(--color-navy-deep)]">Sign + save</div>
            <div className="text-[8px] text-[var(--color-ink-muted)]">Edit any field before signing</div>
          </div>
        </div>
      </div>
    </FadeFrame>
  );
}

function ClientView({ active }: { active: boolean }) {
  return (
    <FadeFrame active={active}>
      <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-[var(--color-cream)] to-[var(--color-cream-deep)] p-6">
        <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg">
          <div className="mb-3 text-center">
            <div className="text-[8px] font-bold uppercase tracking-widest text-[var(--color-teal)]">Wasatch Glow Aesthetics</div>
            <div className="font-display text-base font-bold text-[var(--color-navy)]">Book your next visit</div>
          </div>

          {/* Stepper */}
          <div className="mb-4 flex items-center gap-1">
            {["Service", "Time", "You", "Done"].map((s, i) => (
              <div key={s} className="flex flex-1 items-center gap-1">
                <div
                  className={`flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold ${
                    i <= 1 ? "bg-[var(--color-gold)] text-[var(--color-navy-deep)]" : "bg-[var(--color-line)] text-[var(--color-ink-muted)]"
                  }`}
                >
                  {i + 1}
                </div>
                {i < 3 && <div className={`h-0.5 flex-1 ${i < 1 ? "bg-[var(--color-gold)]" : "bg-[var(--color-line)]"}`} />}
              </div>
            ))}
          </div>

          {/* Service */}
          <div className="mb-3 rounded-md border border-[var(--color-gold)]/40 bg-[var(--color-cream)] p-2">
            <div className="text-[8px] font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">Selected</div>
            <div className="text-[11px] font-semibold text-[var(--color-navy)]">Hydrafacial · 60 min</div>
            <div className="text-[9px] text-[var(--color-ink-muted)]">$185 · Sarah J. · Park City studio</div>
          </div>

          {/* Time slots */}
          <div className="mb-3">
            <div className="mb-1 text-[8px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">Tue · May 5</div>
            <div className="grid grid-cols-4 gap-1">
              {["9:00", "10:30", "12:00", "1:30", "3:00", "4:30", "5:30", "6:30"].map((t, i) => (
                <div
                  key={t}
                  className={`rounded border px-1 py-1 text-center font-mono text-[9px] ${
                    i === 2
                      ? "border-[var(--color-gold)] bg-[var(--color-gold)]/15 font-bold text-[var(--color-navy)]"
                      : "border-[var(--color-line)] text-[var(--color-ink-muted)]"
                  }`}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div className="rounded-md bg-[var(--color-navy-deep)] py-2 text-center text-[10px] font-bold text-[var(--color-cream)]">
            Continue → 12:00 PM
          </div>
        </div>

        {/* Caption */}
        <div className="mt-3 text-center text-[9px] text-[var(--color-ink-muted)]">
          Embedded on the clinic's existing site · iframe-friendly · no domain swap
        </div>
      </div>
    </FadeFrame>
  );
}
