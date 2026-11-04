/**
 * PATCH /api/owner/appointments/[id]  — change status / notes
 *
 * On a transition to status="completed" with a held deposit, captures
 * the PaymentIntent on the connected account (best-effort, off-tx).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { capturePayment } from "@/lib/payments";
import type { AppointmentDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z.object({
  status: z.enum(["scheduled", "checked_in", "in_progress", "completed", "no_show", "cancelled"]).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  type CaptureContext = { paymentIntentId: string } | null;
  let captureContext: CaptureContext = null;

  try {
    captureContext = await db().runTransaction<CaptureContext>(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "appointments").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Not found.");
      const before = snap.data() as AppointmentDoc;
      trx.update(ref, { ...parsed.data, updated_at: now() });
      writeAuditInTx(trx, {
        action: "appointment.update",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "appointment",
        targetId: id,
        before: { status: before.status },
        after: parsed.data,
        ip,
        userAgent: ua,
      });

      // If we're flipping to completed AND there's a held deposit, mark
      // the appointment so the post-tx capture below knows what to do.
      if (
        parsed.data.status === "completed" &&
        before.status !== "completed" &&
        before.deposit_status === "held" &&
        before.deposit_payment_intent_id
      ) {
        return { paymentIntentId: before.deposit_payment_intent_id };
      }
      return null;
    });

    if (captureContext && ctx.tenant.stripe_connect_account_id) {
      void capturePayment({
        tenantId: ctx.tenant.id,
        connectAccountId: ctx.tenant.stripe_connect_account_id,
        paymentIntentId: captureContext.paymentIntentId,
      })
        .then(async () => {
          await tenantCol(ctx.tenant.id, "appointments").doc(id).update({
            deposit_status: "captured",
            updated_at: now(),
          });
        })
        .catch((err) => console.error("[appointment-patch] deposit capture", err));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "Not found." ? 404 : 500 },
    );
  }
}
