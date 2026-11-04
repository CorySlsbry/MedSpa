/**
 * POST /api/owner/appointments/[id]/cancel
 *
 * Marks the appointment cancelled with a reason + actor + timestamp,
 * fires a best-effort cancellation notification (email + SMS) to the
 * client, and audits.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db, now } from "@/lib/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { writeAuditInTx } from "@/lib/audit";
import { sendSmsForTenant, isSmsConfigured } from "@/lib/sms";
import { refundPayment } from "@/lib/payments";
import { PLATFORM_NOREPLY_EMAIL } from "@/lib/email";
import type { AppointmentDoc, ClientDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  reason: z.string().trim().max(500).optional(),
  notify_client: z.boolean().default(true),
});

export async function POST(
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
    payload = {};
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  type NotifyData = {
    clientPhone: string | null;
    clientEmail: string;
    clientName: string;
    service: string;
    startsAt: Date;
    smsConsent: boolean;
  };
  type CancelOutput = {
    notify: NotifyData | null;
    depositPaymentIntentId: string | null;
    depositCents: number | null;
  };

  let output: CancelOutput | null = null;
  try {
    output = await db().runTransaction<CancelOutput>(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "appointments").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Not found.");
      const appt = snap.data() as AppointmentDoc;
      if (appt.status === "cancelled") throw new Error("Already cancelled.");
      if (appt.status === "completed") throw new Error("Cannot cancel a completed visit.");

      const cliRef = tenantCol(ctx.tenant.id, "clients").doc(appt.client_id);
      const cliSnap = await trx.get(cliRef);
      const cli = cliSnap.exists ? (cliSnap.data() as ClientDoc) : null;

      // All reads done — writes follow
      trx.update(ref, {
        status: "cancelled",
        cancelled_at: now(),
        cancellation_reason: parsed.data.reason ?? null,
        cancelled_by_user_id: ctx.user.firebaseUid,
        updated_at: now(),
      });

      writeAuditInTx(trx, {
        action: "appointment.cancel",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "appointment",
        targetId: id,
        // NOTE: deliberately omitting the free-text reason from the audit
        // payload — owners may inadvertently type PHI ("client has X
        // condition"). The reason lives on appt.cancellation_reason where
        // it's at least scoped to the appointment record. Audit captures
        // only that a reason was provided (boolean) + structural fields.
        before: { status: appt.status, starts_at: appt.starts_at.toDate().toISOString() },
        after: { reason_provided: !!parsed.data.reason },
        ip,
        userAgent: ua,
      });

      const notify: NotifyData | null =
        parsed.data.notify_client && cli
          ? {
              clientPhone: cli.phone,
              clientEmail: cli.email,
              clientName: cli.full_name,
              service: appt.service,
              startsAt: appt.starts_at.toDate(),
              smsConsent: cli.sms_consent !== false,
            }
          : null;

      // Surface deposit info so we can issue a refund after the tx
      // commits. Held = authorization not yet captured → refund cancels
      // the auth. Captured = real charge → refund credits the card.
      const refundable =
        (appt.deposit_status === "held" || appt.deposit_status === "captured") &&
        !!appt.deposit_payment_intent_id;
      return {
        notify,
        depositPaymentIntentId: refundable ? appt.deposit_payment_intent_id : null,
        depositCents: refundable ? null : null,
      };
    });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "Not found." ? 404 : msg.includes("Already") || msg.includes("Cannot") ? 409 : 500 },
    );
  }

  // Side-effects (best-effort, off the transactional path)
  const notify = output?.notify ?? null;
  if (notify) {
    void sendCancellationEmail({
      clientEmail: notify.clientEmail,
      clientName: notify.clientName,
      tenantName: ctx.tenant.name,
      ownerEmail: ctx.tenant.owner_email,
      service: notify.service,
      startsAt: notify.startsAt,
      timezone: ctx.tenant.timezone,
      reason: parsed.data.reason ?? null,
    }).catch((err) => console.error("[cancel] email", err));

    if (notify.clientPhone && notify.smsConsent && isSmsConfigured()) {
      const when = notify.startsAt.toLocaleString("en-US", {
        timeZone: ctx.tenant.timezone || "America/Denver",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      void sendSmsForTenant(
        ctx.tenant,
        notify.clientPhone,
        `${ctx.tenant.name}: Your ${notify.service} on ${when} has been cancelled. Reply or call to reschedule.`,
      ).catch((err) => console.error("[cancel] sms", err));
    }
  }

  // Refund the deposit if one was held/captured
  if (output?.depositPaymentIntentId && ctx.tenant.stripe_connect_account_id) {
    void refundPayment({
      tenantId: ctx.tenant.id,
      connectAccountId: ctx.tenant.stripe_connect_account_id,
      paymentIntentId: output.depositPaymentIntentId,
      reason: "requested_by_customer",
    })
      .then(async () => {
        await tenantCol(ctx.tenant.id, "appointments").doc(id).update({
          deposit_status: "refunded",
          updated_at: now(),
        });
      })
      .catch((err) => console.error("[cancel] deposit refund", err));
  }

  return NextResponse.json({ ok: true });
}

async function sendCancellationEmail(args: {
  clientEmail: string;
  clientName: string;
  tenantName: string;
  ownerEmail: string;
  service: string;
  startsAt: Date;
  timezone: string;
  reason: string | null;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const when = args.startsAt.toLocaleString("en-US", {
    timeZone: args.timezone || "America/Denver",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${args.tenantName} <${PLATFORM_NOREPLY_EMAIL}>`,
      to: [args.clientEmail],
      reply_to: args.ownerEmail,
      subject: `${args.tenantName} — your appointment has been cancelled`,
      html: `
        <p>Hi ${args.clientName.split(" ")[0]},</p>
        <p>Your <strong>${args.service}</strong> on ${when} at <strong>${args.tenantName}</strong> has been cancelled.</p>
        ${args.reason ? `<p><em>Reason:</em> ${escapeHtml(args.reason)}</p>` : ""}
        <p>Reply to this email or call us to reschedule.</p>
      `,
    }),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
