/**
 * POST /api/admin/leads/[id]/notes
 *
 * Append a free-form note to a lead. Writes a notes row + an activity row +
 * an audit row in the same transaction.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth-server";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  body: z.string().trim().min(1, "Note can't be empty.").max(5000),
});

export async function POST(
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
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const ip = getIp(req);
  const ua = req.headers.get("user-agent") || null;

  try {
    const noteId = await db().runTransaction(async (trx) => {
      const leadRef = db().collection("leads").doc(id);
      const leadSnap = await trx.get(leadRef);
      if (!leadSnap.exists) throw new Error("Lead not found.");
      const lead = leadSnap.data() as {
        contact_id?: string | null;
        company_id?: string | null;
      };

      const noteRef = db().collection("notes").doc();
      trx.create(noteRef, {
        contact_id: lead.contact_id ?? null,
        company_id: lead.company_id ?? null,
        lead_id: id,
        deal_id: null,
        body: parsed.data.body,
        created_by: session.firebaseUid,
        created_at: now(),
        updated_at: now(),
      });

      const activityRef = db().collection("activities").doc();
      trx.create(activityRef, {
        contact_id: lead.contact_id ?? null,
        company_id: lead.company_id ?? null,
        lead_id: id,
        deal_id: null,
        type: "note",
        summary: parsed.data.body.slice(0, 140) + (parsed.data.body.length > 140 ? "…" : ""),
        details: { note_id: noteRef.id },
        created_by: session.firebaseUid,
        occurred_at: now(),
        created_at: now(),
      });

      writeAuditInTx(trx, {
        action: "note.create",
        actorEmail: session.email,
        actorUserId: session.firebaseUid,
        targetType: "note",
        targetId: noteRef.id,
        after: { lead_id: id, body_length: parsed.data.body.length },
        ip,
        userAgent: ua,
      });

      return noteRef.id;
    });

    return NextResponse.json({ ok: true, noteId });
  } catch (err) {
    const msg = (err as Error).message || "Could not add note.";
    console.error("[admin-leads-notes-post] error", err);
    return NextResponse.json(
      { error: msg },
      { status: msg === "Lead not found." ? 404 : 500 },
    );
  }
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
