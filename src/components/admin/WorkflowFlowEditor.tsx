"use client";

import { useEffect, useState } from "react";
import type { WorkflowStep } from "@/lib/firestore-types";

const VAR_DOCS: { key: string; description: string; example: string }[] = [
  { key: "first_name", description: "Contact's first name", example: "Sarah" },
  { key: "last_name", description: "Contact's last name", example: "Roberts" },
  { key: "full_name", description: "Full name", example: "Sarah Roberts" },
  { key: "email", description: "Contact's email", example: "sarah@example.com" },
  { key: "company_name", description: "Clinic name", example: "Park City Aesthetics" },
  { key: "city", description: "Clinic city", example: "Park City" },
  { key: "state", description: "Clinic state", example: "UT" },
  { key: "website", description: "Clinic website", example: "parkcityaesthetics.com" },
  { key: "sender_name", description: "Your sender name", example: "Cory at Aesthera" },
  { key: "sender_email", description: "Your sender email", example: "person1@example.com" },
];

const ACTION_LABEL: Record<WorkflowStep["action"], string> = {
  apply_tag: "Apply tag",
  remove_tag: "Remove tag",
  wait: "Wait",
  send_email: "Send email",
  set_lead_status: "Set lead status",
  create_task: "Create task",
  webhook: "Fire webhook",
  enroll_in_workflow: "Enroll in workflow",
};

const ACTION_ICON: Record<WorkflowStep["action"], string> = {
  apply_tag: "🏷",
  remove_tag: "✂",
  wait: "⏱",
  send_email: "✉",
  set_lead_status: "✓",
  create_task: "✎",
  webhook: "↗",
  enroll_in_workflow: "⇪",
};

const ACTION_ACCENT: Record<WorkflowStep["action"], string> = {
  apply_tag: "border-l-purple-500 bg-purple-50/40",
  remove_tag: "border-l-purple-300 bg-purple-50/30",
  wait: "border-l-amber-500 bg-amber-50/40",
  send_email: "border-l-[var(--color-gold)] bg-[var(--color-gold)]/5",
  set_lead_status: "border-l-emerald-500 bg-emerald-50/40",
  create_task: "border-l-blue-500 bg-blue-50/30",
  webhook: "border-l-slate-500 bg-slate-50/40",
  enroll_in_workflow: "border-l-teal-500 bg-teal-50/40",
};

function makeStepId(): string {
  return `step_${Math.random().toString(36).slice(2, 10)}`;
}

export type EditorStep = {
  id: string;
  action: WorkflowStep["action"];
  config: Record<string, unknown>;
};

export default function WorkflowFlowEditor({
  initialSteps,
  triggerLabel,
  onChange,
}: {
  initialSteps: EditorStep[];
  triggerLabel: string;
  onChange: (steps: EditorStep[]) => void;
}) {
  const [steps, setSteps] = useState<EditorStep[]>(initialSteps);
  const [expanded, setExpanded] = useState<string | null>(null);

  function commit(next: EditorStep[]) {
    setSteps(next);
    onChange(next);
  }

  function insertAt(idx: number, action: WorkflowStep["action"]) {
    const newStep: EditorStep = { id: makeStepId(), action, config: defaultConfigFor(action) };
    const next = [...steps.slice(0, idx), newStep, ...steps.slice(idx)];
    commit(next);
    setExpanded(newStep.id);
  }

  function update(stepId: string, patch: Partial<EditorStep>) {
    commit(steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)));
  }

  function updateConfig(stepId: string, key: string, value: unknown) {
    commit(
      steps.map((s) =>
        s.id === stepId ? { ...s, config: { ...s.config, [key]: value } } : s,
      ),
    );
  }

  function remove(stepId: string) {
    commit(steps.filter((s) => s.id !== stepId));
  }

  function move(stepId: string, dir: -1 | 1) {
    const idx = steps.findIndex((s) => s.id === stepId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[idx], next[target]] = [next[target], next[idx]];
    commit(next);
  }

  return (
    <div className="space-y-0">
      {/* Trigger node (start) */}
      <div className="rounded-lg border-2 border-dashed border-[var(--color-gold)] bg-[var(--color-gold)]/10 p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-gold)] text-[var(--color-navy-deep)] text-xs font-bold">
            ▶
          </span>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
              Trigger (start)
            </div>
            <div className="text-sm font-semibold text-[var(--color-navy)]">{triggerLabel}</div>
          </div>
        </div>
      </div>

      <Connector />
      <AddStepRow onInsert={(a) => insertAt(0, a)} />

      {steps.map((step, i) => (
        <div key={step.id}>
          <Connector />
          <StepNode
            step={step}
            index={i}
            total={steps.length}
            expanded={expanded === step.id}
            onToggle={() => setExpanded((cur) => (cur === step.id ? null : step.id))}
            onActionChange={(a) => update(step.id, { action: a, config: defaultConfigFor(a) })}
            onConfigChange={(k, v) => updateConfig(step.id, k, v)}
            onMove={(dir) => move(step.id, dir)}
            onRemove={() => remove(step.id)}
          />
          <Connector />
          <AddStepRow onInsert={(a) => insertAt(i + 1, a)} />
        </div>
      ))}

      {/* End node */}
      <Connector />
      <div className="rounded-lg border-2 border-dashed border-[var(--color-line)] bg-[var(--color-cream)] p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-ink-muted)] text-white text-xs font-bold">
            ■
          </span>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            End — enrollment complete
          </div>
        </div>
      </div>
    </div>
  );
}

function Connector() {
  return <div className="mx-auto h-4 w-px bg-[var(--color-line)]" aria-hidden />;
}

function AddStepRow({ onInsert }: { onInsert: (a: WorkflowStep["action"]) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-dashed border-[var(--color-line)] bg-white px-3 py-1 text-[11px] font-semibold text-[var(--color-ink-muted)] transition hover:border-[var(--color-gold)] hover:text-[var(--color-gold-deep)]"
        >
          + Add step
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-white p-2 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)] px-1 pb-1">
        Pick a step type
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(["send_email", "wait", "apply_tag", "remove_tag", "set_lead_status", "create_task", "webhook", "enroll_in_workflow"] as WorkflowStep["action"][]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => {
              onInsert(a);
              setOpen(false);
            }}
            className="rounded-md border border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1 text-[11px] font-semibold text-[var(--color-navy)] hover:bg-[var(--color-cream-deep)]"
          >
            <span className="mr-1">{ACTION_ICON[a]}</span>
            {ACTION_LABEL[a]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto text-[11px] font-semibold text-[var(--color-ink-muted)] hover:underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function StepNode({
  step,
  index,
  total,
  expanded,
  onToggle,
  onActionChange,
  onConfigChange,
  onMove,
  onRemove,
}: {
  step: EditorStep;
  index: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  onActionChange: (a: WorkflowStep["action"]) => void;
  onConfigChange: (key: string, value: unknown) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const accent = ACTION_ACCENT[step.action];
  return (
    <div className={`rounded-lg border-l-4 border-y border-r border-[var(--color-line)] ${accent} bg-white shadow-sm`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-3 text-left"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white border border-[var(--color-line)] text-base">
            {ACTION_ICON[step.action]}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              <span>Step {index + 1}</span>
              <span>·</span>
              <span>{ACTION_LABEL[step.action]}</span>
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-[var(--color-navy)]">
              {summary(step)}
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton title="Move up" disabled={index === 0} onClick={() => onMove(-1)} icon="↑" />
          <IconButton title="Move down" disabled={index === total - 1} onClick={() => onMove(1)} icon="↓" />
          <IconButton title="Remove" onClick={onRemove} icon="🗑" danger />
        </div>
      </div>
      {expanded && (
        <div className="border-t border-[var(--color-line)] px-4 py-3">
          <ConfigEditor step={step} onActionChange={onActionChange} onConfigChange={onConfigChange} />
        </div>
      )}
    </div>
  );
}

function IconButton({
  title,
  icon,
  onClick,
  disabled,
  danger,
}: {
  title: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`h-7 w-7 rounded-md border border-[var(--color-line)] bg-white text-xs disabled:cursor-not-allowed disabled:opacity-30 ${
        danger ? "text-rose-700 hover:bg-rose-50" : "text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
      }`}
    >
      {icon}
    </button>
  );
}

function ConfigEditor({
  step,
  onActionChange,
  onConfigChange,
}: {
  step: EditorStep;
  onActionChange: (a: WorkflowStep["action"]) => void;
  onConfigChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Action
        </span>
        <select
          value={step.action}
          onChange={(e) => onActionChange(e.target.value as WorkflowStep["action"])}
          className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-white px-2 py-1.5 text-sm"
        >
          {Object.entries(ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {ACTION_ICON[k as WorkflowStep["action"]]} {v}
            </option>
          ))}
        </select>
      </label>

      {(step.action === "apply_tag" || step.action === "remove_tag") && (
        <TagPicker
          value={String(step.config.tag ?? "")}
          onChange={(v) => onConfigChange("tag", v)}
        />
      )}

      {step.action === "wait" && (
        <Field
          label="Wait days"
          type="number"
          value={String(step.config.days ?? "")}
          onChange={(v) => onConfigChange("days", Number(v) || 0)}
          placeholder="3"
        />
      )}

      {step.action === "set_lead_status" && (
        <label className="block">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Lead status
          </span>
          <select
            value={String(step.config.status ?? "contacted")}
            onChange={(e) => onConfigChange("status", e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-white px-2 py-1.5 text-sm"
          >
            {[
              "new",
              "contacted",
              "qualified",
              "demo_booked",
              "demo_done",
              "founding_spot_held",
              "closed_won",
              "closed_lost",
              "no_response",
            ].map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      )}

      {step.action === "send_email" && (
        <EmailEditor
          subject={String(step.config.subject ?? "")}
          fromName={String(step.config.from_name ?? "Cory Salisbury")}
          bodyText={String(step.config.body_text ?? "")}
          bodyHtml={String(step.config.body_html ?? "")}
          onChange={(field, value) => onConfigChange(field, value)}
        />
      )}

      {step.action === "create_task" && (
        <>
          <Field
            label="Task title"
            value={String(step.config.title ?? "")}
            onChange={(v) => onConfigChange("title", v)}
            placeholder="Personal LinkedIn DM to {{first_name}}"
          />
          <Field
            label="Due in days"
            type="number"
            value={String(step.config.due_in_days ?? "")}
            onChange={(v) => onConfigChange("due_in_days", Number(v) || 0)}
            placeholder="2"
          />
        </>
      )}

      {step.action === "webhook" && (
        <Field
          label="Webhook URL"
          value={String(step.config.url ?? "")}
          onChange={(v) => onConfigChange("url", v)}
          placeholder="https://..."
        />
      )}

      {step.action === "enroll_in_workflow" && (
        <WorkflowPicker
          value={String(step.config.workflow_id ?? "")}
          onChange={(id, name) => {
            onConfigChange("workflow_id", id);
            onConfigChange("workflow_name", name);
          }}
        />
      )}
    </div>
  );
}

function TagPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [tags, setTags] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listId = `tag-suggestions-${Math.random().toString(36).slice(2, 8)}`;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/tags")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok) {
          setError(j.error ?? "Failed to load tags.");
          return;
        }
        setTags(j.tags as string[]);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = value.trim();
  const isNew = trimmed.length > 0 && tags !== null && !tags.includes(trimmed);

  return (
    <div className="space-y-1">
      <label className="block">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Tag
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="aesthera-cold-outreach-short"
          list={listId}
          className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-white px-2 py-1.5 font-mono text-xs"
          autoComplete="off"
        />
        <datalist id={listId}>
          {(tags ?? []).map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      {error && (
        <p className="text-[10px] text-rose-600">Couldn&apos;t load existing tags: {error}</p>
      )}
      {!error && tags === null && (
        <p className="text-[10px] text-[var(--color-ink-muted)]">Loading existing tags…</p>
      )}
      {!error && tags !== null && (
        <p className="text-[10px] text-[var(--color-ink-muted)]">
          {isNew ? (
            <>
              <span className="font-semibold text-emerald-700">New tag</span> — will be created
              the first time this step runs.
            </>
          ) : trimmed ? (
            <>Existing tag · {tags.length} tag{tags.length === 1 ? "" : "s"} in use</>
          ) : (
            <>Pick from {tags.length} existing tag{tags.length === 1 ? "" : "s"} or type a new one</>
          )}
        </p>
      )}
    </div>
  );
}

type PickerWorkflow = { id: string; name: string; status: string };

function WorkflowPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string, name: string) => void;
}) {
  const [items, setItems] = useState<PickerWorkflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/workflows")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.ok) {
          setError(j.error ?? "Failed to load workflows.");
          return;
        }
        setItems(
          (j.workflows as PickerWorkflow[]).filter((w) => w.status !== "archived"),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Target workflow
        </span>
        {items === null && !error && (
          <div className="mt-1 rounded-md border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs text-[var(--color-ink-muted)]">
            Loading workflows…
          </div>
        )}
        {error && (
          <div className="mt-1 rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
            {error}
          </div>
        )}
        {items && (
          <select
            value={value}
            onChange={(e) => {
              const id = e.target.value;
              const w = items.find((it) => it.id === id);
              onChange(id, w?.name ?? "");
            }}
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-white px-2 py-1.5 text-sm"
          >
            <option value="">— pick a workflow —</option>
            {items.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} {w.status !== "active" ? `· ${w.status}` : ""}
              </option>
            ))}
          </select>
        )}
      </label>
      <p className="text-[10px] text-[var(--color-ink-muted)]">
        When this step fires, the contact gets enrolled in the chosen workflow. If they&apos;re
        already enrolled there, this is a no-op (no double-enrollment).
      </p>
    </div>
  );
}

function EmailEditor({
  subject,
  fromName,
  bodyText,
  bodyHtml,
  onChange,
}: {
  subject: string;
  fromName: string;
  bodyText: string;
  bodyHtml: string;
  onChange: (field: string, value: string) => void;
}) {
  const [showVars, setShowVars] = useState(false);
  const [tab, setTab] = useState<"text" | "html">("text");

  return (
    <div className="space-y-3">
      <Field
        label="Subject line"
        value={subject}
        onChange={(v) => onChange("subject", v)}
        placeholder="{{first_name}} — quick note about {{company_name}}"
      />
      <Field
        label="From name"
        value={fromName}
        onChange={(v) => onChange("from_name", v)}
        placeholder="Cory Salisbury"
      />

      <div>
        <div className="flex items-center justify-between">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Body
          </span>
          <button
            type="button"
            onClick={() => setShowVars((v) => !v)}
            className="text-[10px] font-semibold text-[var(--color-teal)] hover:underline"
          >
            {showVars ? "Hide" : "Show"} variables
          </button>
        </div>
        {showVars && (
          <div className="mt-1 rounded-md border border-[var(--color-line)] bg-[var(--color-cream)] p-2 text-[10px]">
            <p className="text-[var(--color-ink-muted)]">
              Wrap any of these in <code className="bg-white px-1">{"{{"}…{"}}"}</code> in your subject or body —
              they get replaced at send time.
            </p>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {VAR_DOCS.map((v) => (
                <code
                  key={v.key}
                  className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-navy)]"
                  title={`${v.description} (e.g. ${v.example})`}
                >
                  {`{{${v.key}}}`}
                </code>
              ))}
            </div>
          </div>
        )}
        <div className="mt-1 flex border-b border-[var(--color-line)]">
          <button
            type="button"
            onClick={() => setTab("text")}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-semibold ${
              tab === "text"
                ? "border-[var(--color-gold)] text-[var(--color-navy)]"
                : "border-transparent text-[var(--color-ink-muted)]"
            }`}
          >
            Plain text
          </button>
          <button
            type="button"
            onClick={() => setTab("html")}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-semibold ${
              tab === "html"
                ? "border-[var(--color-gold)] text-[var(--color-navy)]"
                : "border-transparent text-[var(--color-ink-muted)]"
            }`}
          >
            HTML
          </button>
        </div>
        {tab === "text" ? (
          <textarea
            rows={10}
            value={bodyText}
            onChange={(e) => onChange("body_text", e.target.value)}
            placeholder={`Hi {{first_name}},\n\nQuick note about {{company_name}}…`}
            className="mt-2 w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 font-mono text-xs"
          />
        ) : (
          <textarea
            rows={10}
            value={bodyHtml}
            onChange={(e) => onChange("body_html", e.target.value)}
            placeholder={`<p>Hi {{first_name}},</p>\n<p>Quick note about {{company_name}}…</p>`}
            className="mt-2 w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 font-mono text-xs"
          />
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  monospace,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  monospace?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-md border border-[var(--color-line)] bg-white px-2 py-1.5 text-sm ${
          monospace ? "font-mono text-xs" : ""
        }`}
      />
    </label>
  );
}

function summary(s: EditorStep): string {
  if (s.action === "apply_tag" || s.action === "remove_tag") {
    return s.config.tag ? String(s.config.tag) : "(no tag set)";
  }
  if (s.action === "wait") {
    const d = s.config.days;
    return d ? `${d} day${d === 1 ? "" : "s"}` : "(no delay)";
  }
  if (s.action === "send_email") {
    return s.config.subject ? String(s.config.subject) : "(no subject yet)";
  }
  if (s.action === "set_lead_status") {
    return s.config.status ? `→ ${String(s.config.status).replace(/_/g, " ")}` : "(no status)";
  }
  if (s.action === "create_task") {
    return s.config.title ? String(s.config.title) : "(no title)";
  }
  if (s.action === "webhook") {
    return s.config.url ? String(s.config.url) : "(no URL)";
  }
  if (s.action === "enroll_in_workflow") {
    if (s.config.workflow_name) return `→ ${String(s.config.workflow_name)}`;
    if (s.config.workflow_id) return `→ ${String(s.config.workflow_id)}`;
    return "(no workflow selected)";
  }
  return "";
}

function defaultConfigFor(action: WorkflowStep["action"]): Record<string, unknown> {
  switch (action) {
    case "apply_tag":
    case "remove_tag":
      return { tag: "" };
    case "wait":
      return { days: 3 };
    case "send_email":
      return {
        subject: "{{first_name}} — note about {{company_name}}",
        from_name: "Cory Salisbury",
        body_text: "Hi {{first_name}},\n\n",
        body_html: "<p>Hi {{first_name}},</p>",
      };
    case "set_lead_status":
      return { status: "contacted" };
    case "create_task":
      return { title: "", due_in_days: 2 };
    case "webhook":
      return { url: "" };
    case "enroll_in_workflow":
      return { workflow_id: "", workflow_name: "" };
  }
}
