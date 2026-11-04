import Link from "next/link";
import type { Metadata } from "next";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";
import type { WorkflowDoc, WorkflowStatus } from "@/lib/firestore-types";
import WorkflowsView from "@/components/admin/WorkflowsView";

export const metadata: Metadata = {
  title: "Admin · Workflows",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type WorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerTag: string | null;
  status: WorkflowStatus;
  cooldownDays: number;
  stepCount: number;
  active: number;
  total: number;
  createdAt: Date | null;
};

async function loadWorkflows(): Promise<WorkflowRow[]> {
  const snap = await db().collection("workflows").orderBy("created_at", "desc").limit(200).get();
  return snap.docs.map((d) => {
    const w = d.data() as WorkflowDoc;
    const triggerTag = typeof w.trigger_config?.tag === "string" ? w.trigger_config.tag : null;
    return {
      id: d.id,
      name: w.name,
      description: w.description,
      triggerType: w.trigger_type,
      triggerTag,
      status: w.status,
      cooldownDays: w.cooldown_days,
      stepCount: Array.isArray(w.steps) ? w.steps.length : 0,
      active: w.active_enrollments ?? 0,
      total: w.total_enrollments ?? 0,
      createdAt:
        w.created_at instanceof Timestamp ? w.created_at.toDate() : null,
    };
  });
}

export default async function WorkflowsPage() {
  let rows: WorkflowRow[] = [];
  let errorMsg: string | null = null;
  try {
    rows = await loadWorkflows();
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            Workflows
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            Cold-outreach + nurture automations for the Aesthera funnel. Tag
            applied at enrollment drives the external email-runner; full
            in-platform send pipeline ships with the Aesthera mailer domain.
          </p>
        </div>
        <Link href="/admin/workflows/new" className="btn btn-gold">
          + New workflow
        </Link>
      </div>

      {errorMsg && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {errorMsg}
        </div>
      )}

      <div className="mt-6">
        <WorkflowsView initialRows={rows} />
      </div>
    </div>
  );
}
