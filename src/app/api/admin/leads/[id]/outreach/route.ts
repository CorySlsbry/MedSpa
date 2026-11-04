/**
 * POST   /api/admin/leads/[id]/outreach  — enroll the lead's contact in a workflow
 * DELETE /api/admin/leads/[id]/outreach?workflow_id=X  — exit
 *
 * Convenience wrapper around the workflow engine, bound to a specific lead
 * so the activity timeline records the enrollment on the lead detail.
 *
 * Super-admin only.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth-server";
import {
  enrollContactInWorkflow,
  exitContactFromWorkflow,
  contactIdForLead,
} from "@/lib/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EnrollBody = z.object({
  workflow_id: z.string().trim().min(1),
});

export async function POST(
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
  const parsed = EnrollBody.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const contactId = await contactIdForLead(id);
  if (!contactId) {
    return NextResponse.json({ error: "Lead has no resolvable contact." }, { status: 404 });
  }

  const result = await enrollContactInWorkflow({
    workflowId: parsed.data.workflow_id,
    contactId,
    source: { type: "lead", leadId: id },
    actorUserId: session.firebaseUid,
    actorEmail: session.email,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: req.headers.get("user-agent") || null,
  });

  if (!result.ok) {
    const status =
      result.reason === "workflow_not_found" || result.reason === "contact_not_found"
        ? 404
        : result.reason === "cooldown"
          ? 409
          : result.reason === "workflow_inactive"
            ? 409
            : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({
    ok: true,
    enrollment_id: result.enrollmentId,
    already_active: result.alreadyActive,
  });
}

export async function DELETE(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id } = await rctx.params;
  const url = new URL(req.url);
  const workflowId = url.searchParams.get("workflow_id");
  if (!workflowId) {
    return NextResponse.json({ error: "workflow_id query param required." }, { status: 400 });
  }
  const contactId = await contactIdForLead(id);
  if (!contactId) {
    return NextResponse.json({ error: "Lead has no resolvable contact." }, { status: 404 });
  }
  const out = await exitContactFromWorkflow({
    workflowId,
    contactId,
    actorUserId: session.firebaseUid,
    actorEmail: session.email,
    reason: "manual_exit",
  });
  return NextResponse.json({ ok: true, exited: out.exited });
}
