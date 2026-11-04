/**
 * GET    /api/admin/workflows/[id]            — full doc + recent enrollments
 * PATCH  /api/admin/workflows/[id]            — update fields (status, name, steps, trigger)
 * DELETE /api/admin/workflows/[id]            — archive (soft delete)
 * POST   /api/admin/workflows/[id]/enroll     — handled in this same route via POST
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth-server";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import type { WorkflowDoc, WorkflowEnrollmentDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StepSchema = z.object({
  id: z.string().trim().min(1).max(60),
  action: z.enum(["apply_tag", "remove_tag", "wait", "send_email", "set_lead_status", "create_task", "webhook", "enroll_in_workflow"]),
  config: z.record(z.string(), z.unknown()).default({}),
});

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  trigger_type: z.enum(["tag_added", "tag_removed", "lead_created", "deal_stage_changed", "manual"]).optional(),
  trigger_config: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(StepSchema).max(50).optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  cooldown_days: z.number().int().min(0).max(365).optional(),
});

export async function GET(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id } = await rctx.params;
  const snap = await db().collection("workflows").doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const w = snap.data() as WorkflowDoc;
  const enrollSnap = await db()
    .collection("workflow_enrollments")
    .where("workflow_id", "==", id)
    .orderBy("enrolled_at", "desc")
    .limit(50)
    .get()
    .catch(() => null);
  const enrollments =
    enrollSnap?.docs.map((d) => {
      const e = d.data() as WorkflowEnrollmentDoc;
      return {
        id: d.id,
        contact_email: e.contact_email,
        status: e.status,
        current_step_index: e.current_step_index,
        source_type: e.source_type,
        source_id: e.source_id,
        enrolled_at: (e.enrolled_at as Timestamp)?.toDate().toISOString() ?? null,
        completed_at: e.completed_at ? (e.completed_at as Timestamp).toDate().toISOString() : null,
        last_error: e.last_error,
      };
    }) ?? [];

  return NextResponse.json({
    ok: true,
    workflow: {
      id,
      name: w.name,
      description: w.description,
      trigger_type: w.trigger_type,
      trigger_config: w.trigger_config,
      steps: w.steps,
      status: w.status,
      cooldown_days: w.cooldown_days,
      active_enrollments: w.active_enrollments ?? 0,
      total_enrollments: w.total_enrollments ?? 0,
      created_at: (w.created_at as Timestamp)?.toDate().toISOString() ?? null,
      updated_at: (w.updated_at as Timestamp)?.toDate().toISOString() ?? null,
    },
    enrollments,
  });
}

export async function PATCH(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id } = await rctx.params;
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Patch.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const ref = db().collection("workflows").doc(id);
  const before = await ref.get();
  if (!before.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const update: Record<string, unknown> = { updated_at: now() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) update[k] = v;
  }
  await ref.update(update);

  await writeAudit({
    action: "admin.user_create",
    actorUserId: session.firebaseUid,
    actorEmail: session.email,
    targetType: "workflow",
    targetId: id,
    before: { status: (before.data() as WorkflowDoc).status },
    after: parsed.data as Record<string, unknown>,
  }).catch((err) => console.error("[workflow-patch] audit", err));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id } = await rctx.params;
  const ref = db().collection("workflows").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await ref.update({ status: "archived", updated_at: now() });

  await writeAudit({
    action: "admin.user_suspend",
    actorUserId: session.firebaseUid,
    actorEmail: session.email,
    targetType: "workflow.archive",
    targetId: id,
  }).catch((err) => console.error("[workflow-delete] audit", err));

  return NextResponse.json({ ok: true });
}
