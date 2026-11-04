"use client";

/**
 * AI SOAP-typing demo. Simulates the provider clicking "Generate AI
 * draft" and watching the chart populate field-by-field with a typing
 * caret. Pure CSS animations + intersection-driven trigger.
 */

import { useEffect, useRef, useState } from "react";
import { Sparkles, Check } from "lucide-react";

const SECTIONS = [
  {
    k: "S",
    label: "Subjective",
    text:
      "Pt c/o moderate glabellar furrows on dynamic frown — concerned about appearing tired. No prior neuromodulator exposure. NKDA. Denies anticoagulant use, recent dental work, or active infection.",
  },
  {
    k: "O",
    label: "Objective",
    text:
      "Forehead/glabella inspected. Skin intact, no erythema or active lesions. Symmetric corrugator and procerus contraction on dynamic assessment. Resting glabellar lines mild.",
  },
  {
    k: "A",
    label: "Assessment",
    text:
      "Glabellar rhytides, Class II — dynamic > static. Appropriate candidate for neuromodulator. No contraindications identified.",
  },
  {
    k: "P",
    label: "Plan",
    text:
      "Botox 20U glabella per CKMP standard 5-point pattern (4U corrugator x4, 4U procerus x1). Aftercare counseled. F/U 2 weeks for assessment + touch-up if asymmetry. Photo-document baseline.",
  },
];

const CHARS_PER_SEC = 220;

export default function AITypeDemo() {
  const [progress, setProgress] = useState<{ section: number; char: number }>({ section: -1, char: 0 });
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && progress.section === -1) {
            setProgress({ section: 0, char: 0 });
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [progress.section]);

  useEffect(() => {
    if (progress.section < 0 || progress.section >= SECTIONS.length) return;
    const sec = SECTIONS[progress.section];
    if (progress.char >= sec.text.length) {
      const t = setTimeout(
        () => setProgress({ section: progress.section + 1, char: 0 }),
        320,
      );
      return () => clearTimeout(t);
    }
    const step = Math.max(2, Math.round(sec.text.length / 80));
    const t = setTimeout(
      () => setProgress({ section: progress.section, char: Math.min(sec.text.length, progress.char + step) }),
      1000 / (CHARS_PER_SEC / step),
    );
    return () => clearTimeout(t);
  }, [progress]);

  const allDone = progress.section >= SECTIONS.length;

  return (
    <div ref={ref} className="grid items-center gap-10 lg:grid-cols-2">
      {/* Left: pitch */}
      <div>
        <div className="tag">AI Drafts</div>
        <h2 className="mt-5">SOAP notes drafted in 1.4 seconds. Reviewed in 30.</h2>
        <div className="rule-gold mt-6" />
        <p className="mt-7 text-lg text-[var(--color-ink-soft)]">
          Click <em>Generate AI draft</em> on any appointment. Vertex AI Gemini reads the booking + service category + last visit and writes a structured SOAP starter — Subjective, Objective, Assessment, Plan. You review, edit, sign.
        </p>
        <ul className="mt-7 space-y-3 text-[var(--color-ink-soft)]">
          {[
            "Never auto-saved or auto-signed — every chart is human-reviewed",
            "Forbidden from inventing vitals, exam findings, or specific dosages",
            "Per-provider rate-limited (30/hr) + audit-logged",
            "Costs ~$0.0003 per draft (Gemini Flash). Negligible at any volume.",
          ].map((b) => (
            <li key={b} className="flex items-start gap-2">
              <Check className="mt-1 h-4 w-4 shrink-0 text-[var(--color-gold-deep)]" strokeWidth={3} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Right: live demo */}
      <div className="browser-chrome relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-cream-deep)]/60 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#ED6A5E]" />
            <span className="h-2 w-2 rounded-full bg-[#F4BF4F]" />
            <span className="h-2 w-2 rounded-full bg-[#62C554]" />
            <span className="ml-2 font-mono text-[10px] tracking-tight text-[var(--color-ink-muted)]">
              provider/charts/edit
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-[var(--color-gold)]/20 px-2 py-0.5">
            <Sparkles className="h-2.5 w-2.5 text-[var(--color-gold-deep)]" strokeWidth={2.5} />
            <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-gold-deep)]">
              {allDone ? "Draft ready · 1.4s" : "Generating…"}
            </span>
          </div>
        </div>

        <div className="space-y-4 bg-white p-6">
          <div>
            <div className="font-display text-base font-bold text-[var(--color-navy)]">Sarah K. · Botox · Glabella</div>
            <div className="text-xs text-[var(--color-ink-muted)]">Tue · May 5 · 9:00 AM · Park City</div>
          </div>

          {SECTIONS.map((sec, i) => {
            const isActive = i === progress.section;
            const isPast = i < progress.section;
            const visibleText =
              isPast || allDone
                ? sec.text
                : isActive
                ? sec.text.slice(0, progress.char)
                : "";
            return (
              <div key={sec.k}>
                <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[var(--color-ink-muted)]">
                  <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-[var(--color-navy-deep)] font-display text-[10px] text-[var(--color-gold)]">
                    {sec.k}
                  </span>
                  {sec.label}
                </div>
                <div className="min-h-[40px] rounded-md border border-[var(--color-line)] bg-[var(--color-cream)]/40 p-2 text-sm leading-snug text-[var(--color-ink-soft)]">
                  {visibleText}
                  {isActive && !allDone && <span className="caret ml-0.5 inline-block h-3.5 w-px align-middle bg-[var(--color-navy)]">|</span>}
                </div>
              </div>
            );
          })}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              disabled={!allDone}
              className={`rounded-md px-4 py-2 text-xs font-bold transition ${
                allDone
                  ? "bg-[var(--color-navy-deep)] text-[var(--color-cream)] shadow-sm"
                  : "bg-[var(--color-line)] text-[var(--color-ink-muted)]"
              }`}
            >
              {allDone ? "Sign + save" : "Drafting…"}
            </button>
            <span className="text-[11px] text-[var(--color-ink-muted)]">All fields editable · audit-logged on sign</span>
          </div>
        </div>
      </div>
    </div>
  );
}
