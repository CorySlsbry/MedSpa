/**
 * PATCH /api/admin/tasks/[id]  — complete or update
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth-server";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import type { TaskStatus } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  status: z.enum(["open", "completed", "cancelled"]).optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await ctx.params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success || !parsed.data.status) {
    return NextResponse.json({ error: "status is required." }, { status: 400 });
  }
  const status: TaskStatus = parsed.data.status;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    await db().runTransaction(async (trx) => {
      const ref = db().collection("tasks").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Task not found.");
      const before = snap.data() as { status?: TaskStatus };
      const updates: Record<string, unknown> = {
        status,
        updated_at: now(),
      };
      if (status === "completed") updates.completed_at = now();
      trx.update(ref, updates);
      writeAuditInTx(trx, {
        action: status === "completed" ? "task.complete" : "task.delete",
        actorEmail: session.email,
        actorUserId: session.firebaseUid,
        targetType: "task",
        targetId: id,
        before: { status: before.status },
        after: { status },
        ip,
        userAgent: ua,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message || "Update failed.";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Task not found." ? 404 : 500 },
    );
  }
}
