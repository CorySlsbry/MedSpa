/**
 * POST /api/admin/replies/[id]/discard — discard an AI-drafted reply
 * without sending. Marks status="discarded" + audit-logs the action.
 */

import { NextResponse } from "next/server";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const ref = db().collection("inbound_replies").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await ref.update({
    status: "discarded",
    discarded_at: now(),
    discarded_by_uid: session.firebaseUid,
    discarded_by_email: session.email,
  });
  await writeAudit({
    action: "lead.update",
    actorEmail: session.email,
    actorUserId: session.firebaseUid,
    targetType: "inbound_reply",
    targetId: id,
    after: { status: "discarded" },
  });
  return NextResponse.json({ ok: true });
}
