/**
 * PATCH /api/admin/leads/[id]
 *
 * Update a lead's status or notes. Writes an activity row + audit row in
 * the same transaction so the timeline stays consistent with the data.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth-server";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import type { LeadStatus } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALL_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "demo_booked",
  "demo_done",
  "founding_spot_held",
  "closed_won",
  "closed_lost",
  "no_response",
];

const Body = z.object({
  status: z.enum([
    "new",
    "contacted",
    "qualified",
    "demo_booked",
    "demo_done",
    "founding_spot_held",
    "closed_won",
    "closed_lost",
    "no_response",
  ]).optional(),
  notes: z.string().trim().max(2000).optional(),
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
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  if (!parsed.data.status && parsed.data.notes === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const ip = getIp(req);
  const ua = req.headers.get("user-agent") || null;

  try {
    const updated = await db().runTransaction(async (trx) => {
      const ref = db().collection("leads").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Lead not found.");
      const before = snap.data() as { status?: LeadStatus; notes?: string | null };

      const updates: Record<string, unknown> = { updated_at: now() };
      if (parsed.data.status && parsed.data.status !== before.status) {
        updates.status = parsed.data.status;
      }
      if (parsed.data.notes !== undefined) {
        updates.notes = parsed.data.notes || null;
      }
      trx.update(ref, updates);

      // Activity row for status change
      if (parsed.data.status && parsed.data.status !== before.status) {
        const activityRef = db().collection("activities").doc();
        trx.create(activityRef, {
          contact_id: (snap.data() as { contact_id?: string }).contact_id ?? null,
          company_id: (snap.data() as { company_id?: string }).company_id ?? null,
          lead_id: id,
          deal_id: null,
          type: "status_change",
          summary: `Status changed: ${before.status ?? "—"} → ${parsed.data.status}`,
          details: { from: before.status ?? null, to: parsed.data.status },
          created_by: session.firebaseUid,
          occurred_at: now(),
          created_at: now(),
        });
      }

      writeAuditInTx(trx, {
        action: parsed.data.status && parsed.data.status !== before.status
          ? "lead.status_change"
          : "lead.update",
        actorEmail: session.email,
        actorUserId: session.firebaseUid,
        targetType: "lead",
        targetId: id,
        before: { status: before.status, notes: before.notes },
        after: {
          status: parsed.data.status ?? before.status,
          notes: parsed.data.notes ?? before.notes,
        },
        ip,
        userAgent: ua,
      });

      return updates;
    });

    return NextResponse.json({ ok: true, updates: updated });
  } catch (err) {
    const msg = (err as Error).message || "Update failed.";
    console.error("[admin-leads-patch] error", err);
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

// `ALL_STATUSES` retained for type-narrowing inside zod enum and
// future-proofing if we add validation against the canonical list.
void ALL_STATUSES;
