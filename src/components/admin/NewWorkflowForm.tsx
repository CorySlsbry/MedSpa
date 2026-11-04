"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WorkflowFlowEditor, { type EditorStep } from "./WorkflowFlowEditor";

export default function NewWorkflowForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<EditorStep[]>([]);
  const [triggerType, setTriggerType] = useState("manual");
  const [triggerTag, setTriggerTag] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const payload = {
      name: String(fd.get("name") || "").trim(),
      description: String(fd.get("description") || "").trim() || null,
      trigger_type: triggerType,
      trigger_config: triggerTag.trim() ? { tag: triggerTag.trim() } : {},
      cooldown_days: Number(fd.get("cooldown_days") || 30),
      status: fd.get("activate_now") ? "active" : "draft",
      steps: steps.map((s) => ({ id: s.id, action: s.action, config: s.config })),
    };
    if (!payload.name) {
      setError("Name is required.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/admin/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.id) {
        setError(body?.error || "Could not create workflow.");
        setSubmitting(false);
        return;
      }
      router.push(`/admin/workflows/${body.id}`);
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name" name="name" required placeholder="Aesthera Cold Outreach — Short" />
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Trigger tag (drives external runner)
          </span>
          <input
            value={triggerTag}
            onChange={(e) => setTriggerTag(e.target.value)}
            placeholder="aesthera-cold-outreach-short"
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 font-mono text-sm shadow-sm"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Description
          </span>
          <textarea
            name="description"
            rows={2}
            maxLength={500}
            placeholder="Internal note about who this targets."
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Trigger type
          </span>
          <select
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm"
          >
            <option value="manual">Manual (CRM enroll)</option>
            <option value="tag_added">Tag added</option>
            <option value="lead_created">Lead created</option>
            <option value="deal_stage_changed">Deal stage changed</option>
          </select>
        </label>
        <Field label="Cooldown (days)" name="cooldown_days" type="number" defaultValue="30" />
      </div>

      <div className="mt-6">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Flow
        </h2>
        <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
          Add the email touches, waits, tag changes, and status updates. Empty
          flow = tag-only workflow (the trigger tag is enough for the external
          runner).
        </p>
        <div className="mt-4">
          <WorkflowFlowEditor
            triggerLabel={
              triggerTag
                ? `${triggerType.replace(/_/g, " ")} — tag: ${triggerTag}`
                : triggerType.replace(/_/g, " ")
            }
            initialSteps={steps}
            onChange={setSteps}
          />
        </div>
      </div>

      <label className="mt-6 flex items-center gap-2 text-sm">
        <input name="activate_now" type="checkbox" />
        Activate immediately (otherwise saves as a draft)
      </label>

      {error && (
        <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-gold disabled:cursor-wait disabled:opacity-70"
        >
          {submitting ? "Creating…" : "Create workflow"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm"
      />
    </label>
  );
}
