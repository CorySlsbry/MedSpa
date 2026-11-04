/**
 * GET /api/admin/workflows  — list (super_admin only)
 * POST /api/admin/workflows  — create (super_admin only)
 *
 * Aesthera platform CRM workflows. Pure Firestore, no SBW data carry.
 * Modeled after salisburybookkeeping.com's /admin/workflows shape, but
 * structurally independent: this is the platform's own funnel automation,
 * not a clinic-tenant feature.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth-server";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import type { WorkflowDoc, WorkflowStep, WorkflowStatus } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const StepSchema = z.object({
  id: z.string().trim().min(1).max(60),
  action: z.enum(["apply_tag", "remove_tag", "wait", "send_email", "set_lead_status", "create_task", "webhook", "enroll_in_workflow"]),
  config: z.record(z.string(), z.unknown()).default({}),
});

const Create = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  trigger_type: z.enum(["tag_added", "tag_removed", "lead_created", "deal_stage_changed", "manual"]).default("manual"),
  trigger_config: z.record(z.string(), z.unknown()).default({}),
  steps: z.array(StepSchema).max(50).default([]),
  status: z.enum(["draft", "active", "paused", "archived"]).default("draft"),
  cooldown_days: z.number().int().min(0).max(365).default(30),
});

export async function GET() {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const snap = await db().collection("workflows").orderBy("created_at", "desc").limit(200).get();
  const workflows = snap.docs.map((d) => {
    const w = d.data() as WorkflowDoc;
    return {
      id: d.id,
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
    };
  });
  return NextResponse.json({ ok: true, workflows });
}

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Create.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const ref = db().collection("workflows").doc();
  const doc: Omit<WorkflowDoc, "created_at" | "updated_at"> & {
    created_at: ReturnType<typeof now>;
    updated_at: ReturnType<typeof now>;
  } = {
    name: data.name,
    description: data.description ?? null,
    trigger_type: data.trigger_type,
    trigger_config: data.trigger_config,
    steps: data.steps as WorkflowStep[],
    status: data.status as WorkflowStatus,
    cooldown_days: data.cooldown_days,
    active_enrollments: 0,
    total_enrollments: 0,
    created_by_user_id: session.firebaseUid,
    created_at: now(),
    updated_at: now(),
  };
  await ref.set(doc);

  await writeAudit({
    action: "admin.user_create",
    actorUserId: session.firebaseUid,
    actorEmail: session.email,
    targetType: "workflow",
    targetId: ref.id,
    after: {
      name: data.name,
      trigger_type: data.trigger_type,
      status: data.status,
    },
  }).catch((err) => console.error("[workflows-post] audit", err));

  return NextResponse.json({ ok: true, id: ref.id });
}
