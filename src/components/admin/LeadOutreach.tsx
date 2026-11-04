"use client";

import { useEffect, useState } from "react";

type Workflow = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  status: string;
};

export default function LeadOutreach({ leadId }: { leadId: string }) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/workflows");
      const body = await res.json();
      if (res.ok) {
        setWorkflows(
          (body.workflows || []).filter(
            (w: Workflow) => w.status === "active" || w.status === "draft",
          ),
        );
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function enroll(workflowId: string) {
    setBusyId(workflowId);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow_id: workflowId }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setToast(
          body.already_active
            ? "Already enrolled — no change."
            : "Enrolled. Tag applied; activity logged.",
        );
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setToast(`Failed: ${body?.error ?? "unknown"}`);
      }
    } catch {
      setToast("Network error.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <p className="text-xs text-[var(--color-ink-muted)]">Loading workflows…</p>
    );
  }
  if (workflows.length === 0) {
    return (
      <p className="text-xs text-[var(--color-ink-muted)]">
        No active workflows yet —{" "}
        <a href="/admin/workflows/new" className="text-[var(--color-teal)] hover:underline">
          create one
        </a>
        .
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--color-ink-muted)]">
        Enrolling applies the workflow&apos;s trigger tag to the contact and
        logs an activity. The external email-runner picks up the tag.
      </p>
      <ul className="space-y-2">
        {workflows.map((w) => {
          const tag = typeof w.trigger_config?.tag === "string" ? w.trigger_config.tag : null;
          return (
            <li
              key={w.id}
              className="rounded-lg border border-[var(--color-line)] bg-white p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--color-navy)]">
                    {w.name}
                  </div>
                  {tag && (
                    <code className="mt-1 inline-block rounded bg-[var(--color-cream)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-navy)]">
                      {tag}
                    </code>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => enroll(w.id)}
                  disabled={busyId === w.id || w.status !== "active"}
                  title={w.status !== "active" ? `Workflow is ${w.status} — activate it first.` : undefined}
                  className="shrink-0 rounded-lg bg-[var(--color-navy)] px-3 py-1.5 text-xs font-semibold text-[var(--color-cream)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyId === w.id ? "Enrolling…" : "Enroll →"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {toast && (
        <p className="rounded-md bg-[var(--color-cream-deep)] px-2 py-1.5 text-[11px] text-[var(--color-navy)]">
          {toast}
        </p>
      )}
    </div>
  );
}
