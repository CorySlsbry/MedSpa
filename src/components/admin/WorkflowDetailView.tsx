"use client";

import Link from "next/link";
import { useState } from "react";
import type { WorkflowStep, WorkflowStatus } from "@/lib/firestore-types";
import type { EnrollmentRow, StepStats } from "@/app/admin/(dashboard)/workflows/[id]/page";
import WorkflowFlowEditor, { type EditorStep } from "./WorkflowFlowEditor";

const STATUS_PILL: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  active: "bg-emerald-100 text-emerald-800",
  paused: "bg-amber-100 text-amber-800",
  archived: "bg-rose-100 text-rose-800",
};

const ENROLL_STATUS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  completed: "bg-blue-100 text-blue-800",
  exited: "bg-gray-100 text-gray-700",
  errored: "bg-rose-100 text-rose-800",
};

export default function WorkflowDetailView({
  id,
  name,
  status,
  triggerType,
  triggerTag,
  cooldownDays,
  steps,
  activeEnrollments,
  totalEnrollments,
  enrollments,
  stepStats,
}: {
  id: string;
  name: string;
  status: WorkflowStatus;
  triggerType: string;
  triggerTag: string | null;
  cooldownDays: number;
  steps: WorkflowStep[];
  activeEnrollments: number;
  totalEnrollments: number;
  enrollments: EnrollmentRow[];
  stepStats: StepStats[];
}) {
  const [currentStatus, setCurrentStatus] = useState<WorkflowStatus>(status);
  const [busy, setBusy] = useState(false);
  const [draftSteps, setDraftSteps] = useState<EditorStep[]>(
    steps.map((s) => ({ id: s.id, action: s.action, config: { ...s.config } })),
  );
  const [dirty, setDirty] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  async function setStatus(next: WorkflowStatus) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) setCurrentStatus(next);
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!confirm(`Archive "${name}"? It stops running and disappears from the list.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/workflows/${id}`, { method: "DELETE" });
      if (res.ok) setCurrentStatus("archived");
    } finally {
      setBusy(false);
    }
  }

  async function saveSteps() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/workflows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: draftSteps }),
      });
      if (res.ok) {
        setDirty(false);
        setSavedToast(true);
        setTimeout(() => setSavedToast(false), 2200);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-5">
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Flow
            </h2>
            <div className="flex items-center gap-3">
              {savedToast && (
                <span className="text-[11px] font-semibold text-emerald-700">Saved.</span>
              )}
              <button
                type="button"
                onClick={saveSteps}
                disabled={!dirty || busy}
                className="rounded-lg bg-[var(--color-navy)] px-3 py-1.5 text-xs font-semibold text-[var(--color-cream)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Saving…" : dirty ? "Save flow" : "All saved"}
              </button>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
            Click a step to edit. Reorder with the arrows. Hit save when done.
            Subject + body support {`{{first_name}}`}, {`{{company_name}}`}, etc.
            (variables list inside each email step).
          </p>
          <div className="mt-4">
            <WorkflowFlowEditor
              triggerLabel={
                triggerTag
                  ? `${triggerType.replace(/_/g, " ")} — tag: ${triggerTag}`
                  : triggerType.replace(/_/g, " ")
              }
              initialSteps={draftSteps}
              onChange={(next) => {
                setDraftSteps(next);
                setDirty(true);
              }}
            />
          </div>
        </section>

        {/* Per-step stats panel — shows funnel through the workflow */}
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Per-step stats
            </h2>
            <span className="text-[11px] text-[var(--color-ink-muted)]">
              Updated each page load
            </span>
          </div>
          {stepStats.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
              No steps yet. Add a step in the flow editor above.
            </p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                <tr>
                  <th className="pb-2 pr-3">#</th>
                  <th className="pb-2 pr-3">Action</th>
                  <th className="pb-2 pr-3 text-right">Reached</th>
                  <th className="pb-2 pr-3 text-right">At step</th>
                  <th className="pb-2 pr-3 text-right">Completed</th>
                  <th className="pb-2 pr-3 text-right">Sends</th>
                  <th className="pb-2 pr-3 text-right">Open rate</th>
                  <th className="pb-2 text-right">Click rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {stepStats.map((s) => {
                  const stepDef = steps[s.index];
                  const action = stepDef?.action ?? "—";
                  const isEmail = action === "send_email";
                  const openRate = isEmail && s.sends && s.sends > 0 && s.opens !== null
                    ? `${Math.round((s.opens / s.sends) * 100)}%`
                    : "—";
                  const clickRate = isEmail && s.sends && s.sends > 0 && s.clicks !== null
                    ? `${Math.round((s.clicks / s.sends) * 100)}%`
                    : "—";
                  return (
                    <tr key={s.index}>
                      <td className="py-2 pr-3 font-mono text-xs text-[var(--color-ink-muted)]">{s.index + 1}</td>
                      <td className="py-2 pr-3 text-xs">
                        <span className="rounded bg-[var(--color-cream-deep)] px-2 py-0.5 font-mono text-[10px]">
                          {action}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right text-xs tabular-nums text-[var(--color-navy)]">{s.reached}</td>
                      <td className="py-2 pr-3 text-right text-xs tabular-nums">
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">{s.active}</span>
                      </td>
                      <td className="py-2 pr-3 text-right text-xs tabular-nums text-[var(--color-ink-muted)]">{s.completed}</td>
                      <td className="py-2 pr-3 text-right text-xs tabular-nums">
                        {isEmail ? (
                          <div className="flex flex-col items-end leading-tight">
                            <span className="font-bold text-emerald-700">{s.sends ?? 0}</span>
                            {(s.queued ?? 0) > 0 && (
                              <span className="text-[10px] text-amber-700">{s.queued} queued</span>
                            )}
                            {(s.failed ?? 0) > 0 && (
                              <span className="text-[10px] text-rose-700">{s.failed} failed</span>
                            )}
                            {(s.skipped ?? 0) > 0 && (
                              <span className="text-[10px] text-[var(--color-ink-muted)]">{s.skipped} skipped</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[var(--color-ink-muted)]">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs tabular-nums text-[var(--color-ink-muted)]">{openRate}</td>
                      <td className="py-2 text-right text-xs tabular-nums text-[var(--color-ink-muted)]">{clickRate}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-[10px] text-[var(--color-ink-muted)]">
            Sends/queued/failed/skipped + open/click rates are live from{" "}
            <code>scheduled_emails</code>. Open + click stamps come from the Resend webhook,
            correlated by the <code>scheduled_email_id</code> tag we set at send time —
            so events only appear for emails sent after the tracking deploy. Reached/at-step/
            completed counts come from <code>workflow_enrollments</code>.
          </p>
        </section>

        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Recent enrollments
            </h2>
            <span className="text-xs text-[var(--color-ink-muted)]">
              {activeEnrollments} active · {totalEnrollments} total
            </span>
          </div>
          {enrollments.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
              No enrollments yet. Enroll a lead from /admin/leads/[id] to get started.
            </p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                <tr>
                  <th className="pb-2 pr-3">Contact</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Source</th>
                  <th className="pb-2 pr-3">Step</th>
                  <th className="pb-2">Enrolled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {enrollments.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-3 text-xs">{e.contactEmail}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          ENROLL_STATUS[e.status] || ENROLL_STATUS.exited
                        }`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-[var(--color-ink-muted)]">
                      {e.sourceType === "lead" && e.sourceId ? (
                        <Link
                          href={`/admin/leads/${e.sourceId}`}
                          className="text-[var(--color-teal)] hover:underline"
                        >
                          lead
                        </Link>
                      ) : (
                        e.sourceType
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[var(--color-ink-muted)]">
                      {e.currentStep}
                    </td>
                    <td className="py-2 text-xs text-[var(--color-ink-muted)]">
                      {e.enrolledAt ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <aside className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Settings
        </h2>
        <dl className="mt-3 space-y-3 text-sm">
          <Row
            label="Status"
            value={
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  STATUS_PILL[currentStatus] || STATUS_PILL.draft
                }`}
              >
                {currentStatus}
              </span>
            }
          />
          <Row label="Trigger" value={<span className="text-xs">{triggerType.replace(/_/g, " ")}</span>} />
          {triggerTag && (
            <Row
              label="Trigger tag"
              value={
                <code className="rounded bg-[var(--color-cream)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-navy)]">
                  {triggerTag}
                </code>
              }
            />
          )}
          <Row label="Cooldown" value={<span className="text-xs">{cooldownDays} days</span>} />
        </dl>

        <div className="mt-5 space-y-2">
          {currentStatus === "active" && (
            <button
              type="button"
              onClick={() => setStatus("paused")}
              disabled={busy}
              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 disabled:opacity-50"
            >
              Pause workflow
            </button>
          )}
          {(currentStatus === "paused" || currentStatus === "draft") && (
            <button
              type="button"
              onClick={() => setStatus("active")}
              disabled={busy}
              className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Activate
            </button>
          )}
          {currentStatus !== "archived" && (
            <button
              type="button"
              onClick={archive}
              disabled={busy}
              className="w-full rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900 disabled:opacity-50"
            >
              Archive
            </button>
          )}
        </div>

        <p className="mt-5 text-[10px] text-[var(--color-ink-muted)]">
          Email send pipeline still runs externally via the trigger tag.
          Native Aesthera mailer ships with the platform&apos;s own domain.
        </p>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs uppercase tracking-wider text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function labelForAction(a: WorkflowStep["action"]): string {
  switch (a) {
    case "apply_tag": return "Apply tag";
    case "remove_tag": return "Remove tag";
    case "wait": return "Wait";
    case "send_email": return "Send email";
    case "set_lead_status": return "Set lead status";
    case "create_task": return "Create task";
    case "webhook": return "Fire webhook";
    case "enroll_in_workflow": return "Enroll in workflow";
  }
}

function summarizeConfig(s: WorkflowStep): string {
  if (s.action === "apply_tag" || s.action === "remove_tag") {
    return s.config?.tag ? `tag=${s.config.tag}` : "";
  }
  if (s.action === "wait") {
    return s.config?.days ? `${s.config.days}d` : "";
  }
  if (s.action === "send_email") {
    return s.config?.template_id ? `tpl=${s.config.template_id}` : "send";
  }
  if (s.action === "set_lead_status") {
    return s.config?.status ? `status=${s.config.status}` : "";
  }
  return "";
}
