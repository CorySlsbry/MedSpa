"use client";

import { useState } from "react";
import type { ChartView } from "@/app/provider/charts/[appointmentId]/page";

const SOAP_PROMPTS = {
  subjective:
    "What the client says — chief concern, history, recent events. Their words.",
  objective:
    "What you observe — vitals, exam findings, photos taken, products used.",
  assessment: "Your clinical assessment — diagnosis, response to prior treatment.",
  plan: "What's next — treatment performed today, dose, post-care, follow-up timing.",
};

export default function ChartEditor({ initial }: { initial: ChartView }) {
  const [subjective, setSubjective] = useState(initial.chart.subjective);
  const [objective, setObjective] = useState(initial.chart.objective);
  const [assessment, setAssessment] = useState(initial.chart.assessment);
  const [plan, setPlan] = useState(initial.chart.plan);
  const [signed, setSigned] = useState(initial.chart.status === "signed");
  const [signedAt, setSignedAt] = useState(initial.chart.signedAt);
  const [signedBy, setSignedBy] = useState(initial.chart.signedByFullName);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  async function generateAiDraft() {
    if (
      (subjective || objective || assessment || plan) &&
      !confirm(
        "This will overwrite your current draft with an AI-generated starter. Keep going?",
      )
    ) {
      return;
    }
    setAiLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(
        `/api/provider/charts/${initial.appointmentId}/ai-draft`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "AI is unavailable right now.");
        setAiLoading(false);
        return;
      }
      const d = body.draft || {};
      setSubjective(d.subjective || "");
      setObjective(d.objective || "");
      setAssessment(d.assessment || "");
      setPlan(d.plan || "");
      setSuccessMsg("AI draft loaded. Review and edit before signing.");
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setAiLoading(false);
    }
  }

  async function save(action: "save_draft" | "sign") {
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(
        `/api/provider/charts/${initial.appointmentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjective: subjective || null,
            objective: objective || null,
            assessment: assessment || null,
            plan: plan || null,
            action,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Could not save.");
      } else {
        if (action === "sign") {
          setSigned(true);
          setSignedAt(new Date());
          setSuccessMsg("Chart signed. This entry is now immutable.");
        } else {
          setSuccessMsg("Draft saved.");
          setTimeout(() => setSuccessMsg(null), 2000);
        }
      }
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setSaving(false);
    }
  }

  function confirmSign() {
    if (!subjective && !objective && !assessment && !plan) {
      setErrorMsg("Add some content before signing.");
      return;
    }
    if (
      !confirm(
        "Sign this chart? Once signed, the entry is immutable — to amend, you'd create a new chart that references this one (coming in Phase 3+).",
      )
    ) {
      return;
    }
    save("sign");
  }

  return (
    <div className="space-y-4">
      {signed && (
        <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <strong>Signed</strong>
          {signedAt && ` on ${signedAt.toLocaleString()}`}
          {signedBy && ` by ${signedBy}`}
          . This chart is now read-only.
        </div>
      )}

      {!signed && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-[var(--color-gold)] bg-[var(--color-gold)]/5 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-[var(--color-navy)]">
              ✨ Draft with AI
            </div>
            <div className="text-xs text-[var(--color-ink-muted)]">
              Vertex AI Gemini reads the service, client tags, and last
              signed visit — produces a SOAP starter you edit and sign.
            </div>
          </div>
          <button
            type="button"
            onClick={generateAiDraft}
            disabled={aiLoading}
            className="whitespace-nowrap rounded-lg border border-[var(--color-gold)] bg-[var(--color-paper)] px-3 py-2 text-xs font-semibold text-[var(--color-gold-deep)] hover:bg-[var(--color-gold)]/10 disabled:cursor-wait disabled:opacity-70"
          >
            {aiLoading ? "Drafting..." : "Generate AI draft"}
          </button>
        </div>
      )}

      <SoapField
        label="Subjective"
        prompt={SOAP_PROMPTS.subjective}
        value={subjective}
        onChange={setSubjective}
        disabled={signed}
      />
      <SoapField
        label="Objective"
        prompt={SOAP_PROMPTS.objective}
        value={objective}
        onChange={setObjective}
        disabled={signed}
      />
      <SoapField
        label="Assessment"
        prompt={SOAP_PROMPTS.assessment}
        value={assessment}
        onChange={setAssessment}
        disabled={signed}
      />
      <SoapField
        label="Plan"
        prompt={SOAP_PROMPTS.plan}
        value={plan}
        onChange={setPlan}
        disabled={signed}
      />

      {errorMsg && (
        <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="rounded-lg border-l-4 border-[var(--color-teal)] bg-[var(--color-teal-soft)] px-4 py-3 text-sm text-[var(--color-teal-deep)]">
          {successMsg}
        </div>
      )}

      {!signed && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => save("save_draft")}
            disabled={saving}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-2 text-sm font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)] disabled:cursor-wait disabled:opacity-70"
          >
            {saving ? "Saving..." : "Save draft"}
          </button>
          <button
            type="button"
            onClick={confirmSign}
            disabled={saving}
            className="btn btn-gold disabled:cursor-wait disabled:opacity-70"
          >
            {saving ? "Signing..." : "Sign and save"}
          </button>
        </div>
      )}

      <p className="pt-4 text-xs text-[var(--color-ink-muted)]">
        Photos, signatures, and inventory deduction land in Phase 3+. Real
        PHI use requires the HIPAA BAA to be signed (see{" "}
        <code className="font-mono">firestore/runbooks/02-security-hardening.md</code>).
      </p>
    </div>
  );
}

function SoapField({
  label,
  prompt,
  value,
  onChange,
  disabled,
}: {
  label: string;
  prompt: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-gold-deep)]">
        {label}
      </span>
      <span className="block text-[10px] text-[var(--color-ink-muted)]">{prompt}</span>
      <textarea
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 font-mono text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20 disabled:cursor-not-allowed disabled:bg-[var(--color-cream-deep)] disabled:text-[var(--color-ink)]"
      />
    </label>
  );
}
