/**
 * POST /api/owner/appointments/[id]/reschedule
 *
 * Move an appointment to a new starts_at. Conflict-checks against the
 * same provider's other active appointments. Records the original
 * starts_at in rescheduled_from_at + bumps reschedule_count. Best-effort
 * client notification.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { writeAuditInTx } from "@/lib/audit";
import { sendSmsForTenant, isSmsConfigured } from "@/lib/sms";
import { PLATFORM_NOREPLY_EMAIL } from "@/lib/email";
import type { AppointmentDoc, ClientDoc, ServiceDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Strict so callers passing future fields (e.g. provider_id) fail loudly
// instead of silently being dropped — the conflict re-check below uses the
// existing appt.provider_id and would not pick up an intended provider change.
const Body = z
  .object({
    starts_at: z.string().datetime(),
    notify_client: z.boolean().default(true),
  })
  .strict();

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
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const newStartsAt = new Date(parsed.data.starts_at);
  if (newStartsAt.getTime() < Date.now() + 5 * 60_000) {
    return NextResponse.json(
      { error: "New time must be at least 5 minutes from now." },
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
    oldStartsAt: Date;
    newStartsAt: Date;
    smsConsent: boolean;
    providerName: string;
  };
  let data: NotifyData | null = null;
  try {
    data = await db().runTransaction<NotifyData | null>(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "appointments").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Not found.");
      const appt = snap.data() as AppointmentDoc;
      if (appt.status === "cancelled") throw new Error("Cannot reschedule a cancelled appointment.");
      if (appt.status === "completed") throw new Error("Cannot reschedule a completed visit.");

      // Resolve service for duration → ends_at
      const svcQuery = await trx.get(
        tenantCol(ctx.tenant.id, "services").where("name", "==", appt.service).limit(1),
      );
      const svc = !svcQuery.empty ? (svcQuery.docs[0].data() as ServiceDoc) : null;
      const durationMin = svc?.duration_minutes ?? Math.round(((appt.ends_at as Timestamp).toMillis() - (appt.starts_at as Timestamp).toMillis()) / 60_000);
      const newEndsAt = new Date(newStartsAt.getTime() + durationMin * 60_000);

      // Conflict re-check (same provider, ±36h window, active statuses,
      // excluding THIS appointment). 36h covers max 8h service duration
      // (services.duration_minutes max 480) overlapping near the window
      // boundary — a candidate starting 28h before newStartsAt and lasting
      // 8h would still overlap if newStartsAt's service is also long.
      const dayBefore = new Date(newStartsAt.getTime() - 36 * 60 * 60 * 1000);
      const dayAfter = new Date(newStartsAt.getTime() + 36 * 60 * 60 * 1000);
      const candidates = await trx.get(
        tenantCol(ctx.tenant.id, "appointments")
          .where("provider_id", "==", appt.provider_id)
          .where("starts_at", ">=", Timestamp.fromDate(dayBefore))
          .where("starts_at", "<=", Timestamp.fromDate(dayAfter)),
      );
      const ACTIVE: AppointmentDoc["status"][] = ["scheduled", "checked_in", "in_progress"];
      for (const c of candidates.docs) {
        if (c.id === id) continue;
        const cd = c.data() as AppointmentDoc;
        if (!ACTIVE.includes(cd.status)) continue;
        const cs = (cd.starts_at as Timestamp).toDate();
        const ce = (cd.ends_at as Timestamp).toDate();
        if (cs < newEndsAt && ce > newStartsAt) {
          throw new Error("That provider is already booked at the new time.");
        }
      }

      // Resolve client + provider for notification
      const cliRef = tenantCol(ctx.tenant.id, "clients").doc(appt.client_id);
      const provRef = tenantCol(ctx.tenant.id, "providers").doc(appt.provider_id);
      const [cliSnap, provSnap] = await Promise.all([trx.get(cliRef), trx.get(provRef)]);
      const cli = cliSnap.exists ? (cliSnap.data() as ClientDoc) : null;
      const provName = provSnap.exists ? ((provSnap.data() as { full_name?: string }).full_name ?? "your provider") : "your provider";
      const oldStartsAt = (appt.starts_at as Timestamp).toDate();

      // All reads done — writes follow
      trx.update(ref, {
        starts_at: Timestamp.fromDate(newStartsAt),
        ends_at: Timestamp.fromDate(newEndsAt),
        rescheduled_from_at: Timestamp.fromDate(oldStartsAt),
        reschedule_count: FieldValue.increment(1),
        // Reset reminder so the new time gets its own 24h ping
        reminder_sms_at: null,
        updated_at: now(),
      });

      writeAuditInTx(trx, {
        action: "appointment.reschedule",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "appointment",
        targetId: id,
        before: { starts_at: oldStartsAt.toISOString() },
        after: { starts_at: newStartsAt.toISOString() },
        ip,
        userAgent: ua,
      });

      if (parsed.data.notify_client && cli) {
        return {
          clientPhone: cli.phone,
          clientEmail: cli.email,
          clientName: cli.full_name,
          service: appt.service,
          oldStartsAt,
          newStartsAt,
          smsConsent: cli.sms_consent !== false,
          providerName: provName,
        };
      }
      return null;
    });
  } catch (err) {
    const msg = (err as Error).message;
    let status = 500;
    if (msg === "Not found.") status = 404;
    else if (msg.includes("Cannot") || msg.includes("already booked") || msg.includes("must be")) status = 409;
    return NextResponse.json({ error: msg }, { status });
  }

  if (data) {
    void sendRescheduleEmail({
      clientEmail: data.clientEmail,
      clientName: data.clientName,
      tenantName: ctx.tenant.name,
      ownerEmail: ctx.tenant.owner_email,
      service: data.service,
      providerName: data.providerName,
      newStartsAt: data.newStartsAt,
      timezone: ctx.tenant.timezone,
    }).catch((err) => console.error("[reschedule] email", err));
    if (data.clientPhone && data.smsConsent && isSmsConfigured()) {
      const when = data.newStartsAt.toLocaleString("en-US", {
        timeZone: ctx.tenant.timezone || "America/Denver",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      void sendSmsForTenant(
        ctx.tenant,
        data.clientPhone,
        `${ctx.tenant.name}: Your ${data.service} has been rescheduled to ${when}. See you then!`,
      ).catch((err) => console.error("[reschedule] sms", err));
    }
  }

  return NextResponse.json({ ok: true });
}

async function sendRescheduleEmail(args: {
  clientEmail: string;
  clientName: string;
  tenantName: string;
  ownerEmail: string;
  service: string;
  providerName: string;
  newStartsAt: Date;
  timezone: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const when = args.newStartsAt.toLocaleString("en-US", {
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
      subject: `${args.tenantName} — your appointment is rescheduled`,
      html: `
        <p>Hi ${args.clientName.split(" ")[0]},</p>
        <p>Your <strong>${args.service}</strong> with ${args.providerName} at <strong>${args.tenantName}</strong> has been rescheduled to <strong>${when}</strong>.</p>
        <p>Need another time? Reply to this email and we'll find one that works.</p>
      `,
    }),
  });
}
