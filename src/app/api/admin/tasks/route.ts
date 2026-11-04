/**
 * GET /api/admin/tasks  — list (open by default)
 * POST /api/admin/tasks — create
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth-server";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import type { TaskDoc, TaskPriority } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  due_at: z.string().datetime().optional(),
  contact_id: z.string().trim().email().optional(),
  lead_id: z.string().trim().min(1).optional(),
});

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

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

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    const taskId = await db().runTransaction(async (trx) => {
      const ref = db().collection("tasks").doc();
      const doc: Omit<TaskDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        contact_id: data.contact_id ?? null,
        company_id: null,
        lead_id: data.lead_id ?? null,
        deal_id: null,
        title: data.title,
        description: data.description ?? null,
        status: "open",
        priority: data.priority as TaskPriority,
        due_at: data.due_at ? (new Date(data.due_at) as unknown as TaskDoc["due_at"]) : null,
        completed_at: null,
        assigned_to: session.firebaseUid,
        created_by: session.firebaseUid,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(ref, doc);
      writeAuditInTx(trx, {
        action: "task.create",
        actorEmail: session.email,
        actorUserId: session.firebaseUid,
        targetType: "task",
        targetId: ref.id,
        after: { title: data.title, priority: data.priority },
        ip,
        userAgent: ua,
      });
      return ref.id;
    });
    return NextResponse.json({ ok: true, taskId });
  } catch (err) {
    console.error("[tasks-post] error", err);
    return NextResponse.json({ error: "Could not create task." }, { status: 500 });
  }
}
