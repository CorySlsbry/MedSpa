import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";
import type {
  WorkflowDoc,
  WorkflowEnrollmentDoc,
} from "@/lib/firestore-types";
import WorkflowDetailView from "@/components/admin/WorkflowDetailView";

export const metadata: Metadata = {
  title: "Admin · Workflow",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export type EnrollmentRow = {
  id: string;
  contactEmail: string;
  status: string;
  currentStep: number;
  sourceType: string;
  sourceId: string | null;
  enrolledAt: string | null;
  completedAt: string | null;
  lastError: string | null;
};

export type StepStats = {
  index: number;
  active: number;
  completed: number;
  exited: number;
  errored: number;
  /** total contacts that have reached this step (active + downstream) */
  reached: number;
  /** Sends/opens/clicks if this step is a send_email — populated from scheduled_emails. */
  sends: number | null;
  /** Queued (not yet fired) — only set for send_email steps. */
  queued: number | null;
  /** Failed sends — only set for send_email steps. */
  failed: number | null;
  /** Skipped sends (DND, missing contact, etc.) — only set for send_email steps. */
  skipped: number | null;
  opens: number | null;
  clicks: number | null;
};

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const snap = await db().collection("workflows").doc(id).get();
  if (!snap.exists) notFound();
  const w = snap.data() as WorkflowDoc;

  // Pull ALL enrollments for stats (paginate-safe limit; small workflows are
  // fine, large workflows would need a counter pattern — TODO).
  const allEnrollSnap = await db()
    .collection("workflow_enrollments")
    .where("workflow_id", "==", id)
    .limit(2000)
    .get()
    .catch(() => null);
  const allEnrollments = (allEnrollSnap?.docs ?? []).map((d) => d.data() as WorkflowEnrollmentDoc);

  // Compute per-step stats from the enrollments.
  // - active count = enrollments with current_step_index === i AND status === active
  // - completed/exited/errored grouped likewise
  // - "reached" is anyone who got at least to step i (active here OR past-i in any state).
  const steps = Array.isArray(w.steps) ? w.steps : [];
  const stepStats: StepStats[] = steps.map((_, i) => {
    let active = 0, completed = 0, exited = 0, errored = 0, reached = 0;
    for (const e of allEnrollments) {
      const idx = typeof e.current_step_index === "number" ? e.current_step_index : 0;
      if (idx >= i) reached++;
      if (idx === i) {
        if (e.status === "active") active++;
        else if (e.status === "completed") completed++;
        else if (e.status === "exited") exited++;
        else if (e.status === "errored") errored++;
      }
    }
    return {
      index: i, active, completed, exited, errored, reached,
      sends: null, queued: null, failed: null, skipped: null, opens: null, clicks: null,
    };
  });

  // Real per-step counts from scheduled_emails. We pull opens_count +
  // clicks_count too — the Resend webhook stamps these on each row when
  // the user opens/clicks (correlated by scheduled_email_id tag).
  const seSnap = await db()
    .collection("scheduled_emails")
    .where("workflow_id", "==", id)
    .select("step_index", "status", "opens_count", "clicks_count")
    .limit(5000)
    .get()
    .catch(() => null);

  type StepBucket = {
    sent: number;
    queued: number;
    failed: number;
    skipped: number;
    opens: number;
    clicks: number;
  };
  const sendCounts = new Map<number, StepBucket>();
  if (seSnap) {
    for (const d of seSnap.docs) {
      const e = d.data() as {
        step_index?: number;
        status?: string;
        opens_count?: number;
        clicks_count?: number;
      };
      if (typeof e.step_index !== "number") continue;
      const b = sendCounts.get(e.step_index) ?? {
        sent: 0, queued: 0, failed: 0, skipped: 0, opens: 0, clicks: 0,
      };
      if (e.status === "sent") b.sent++;
      else if (e.status === "queued") b.queued++;
      else if (e.status === "failed") b.failed++;
      else if (e.status === "skipped") b.skipped++;
      // Open/click are unique-per-row counts (1 if recipient opened at all,
      // 2 if they opened twice, etc). Sum across all rows for the step.
      if (typeof e.opens_count === "number") b.opens += e.opens_count;
      if (typeof e.clicks_count === "number") b.clicks += e.clicks_count;
      sendCounts.set(e.step_index, b);
    }
  }

  for (let i = 0; i < steps.length; i++) {
    if (steps[i].action !== "send_email") continue;
    const b = sendCounts.get(i) ?? {
      sent: 0, queued: 0, failed: 0, skipped: 0, opens: 0, clicks: 0,
    };
    stepStats[i].sends = b.sent;
    stepStats[i].queued = b.queued;
    stepStats[i].failed = b.failed;
    stepStats[i].skipped = b.skipped;
    stepStats[i].opens = b.opens;
    stepStats[i].clicks = b.clicks;
  }

  // Recent 50 enrollments for the table view (sorted by most-recent).
  const enrollments: EnrollmentRow[] = allEnrollments
    .map((e, i) => {
      const docId = allEnrollSnap?.docs[i]?.id ?? "";
      return {
        id: docId,
        contactEmail: e.contact_email,
        status: e.status,
        currentStep: e.current_step_index,
        sourceType: e.source_type,
        sourceId: e.source_id,
        enrolledAt:
          e.enrolled_at instanceof Timestamp ? e.enrolled_at.toDate().toLocaleString() : null,
        completedAt:
          e.completed_at instanceof Timestamp ? e.completed_at.toDate().toLocaleString() : null,
        lastError: e.last_error,
      };
    })
    .sort((a, b) => (b.enrolledAt ?? "").localeCompare(a.enrolledAt ?? ""))
    .slice(0, 50);

  const triggerTag = typeof w.trigger_config?.tag === "string" ? w.trigger_config.tag : null;

  return (
    <div>
      <Link href="/admin/workflows" className="text-sm text-[var(--color-teal)] hover:underline">
        ← All workflows
      </Link>
      <h1 className="mt-3 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
        {w.name}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        {w.description || "No description."}
      </p>

      <div className="mt-6">
        <WorkflowDetailView
          id={id}
          name={w.name}
          status={w.status}
          triggerType={w.trigger_type}
          triggerTag={triggerTag}
          cooldownDays={w.cooldown_days}
          steps={Array.isArray(w.steps) ? w.steps : []}
          activeEnrollments={w.active_enrollments ?? 0}
          totalEnrollments={w.total_enrollments ?? 0}
          enrollments={enrollments}
          stepStats={stepStats}
        />
      </div>
    </div>
  );
}
