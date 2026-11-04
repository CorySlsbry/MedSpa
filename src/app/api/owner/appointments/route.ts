/**
 * POST /api/owner/appointments  — schedule a new appointment.
 *
 * Validates that location, provider, service, and client all belong to
 * this tenant. Computes ends_at from service duration. Writes the
 * appointment + audit row in one transaction.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { sendSmsForTenant, buildConfirmationSms, isSmsConfigured } from "@/lib/sms";
import type {
  AppointmentDoc,
  ProviderDoc,
  ServiceDoc,
  ClientDoc,
  LocationDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  client_id: z.string().trim().min(1),
  provider_id: z.string().trim().min(1),
  location_id: z.string().trim().min(1),
  service_id: z.string().trim().min(1),
  starts_at: z.string().datetime(),
  notes: z.string().trim().max(2000).optional(),
});

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

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

  let smsBundle:
    | { phone: string; tenantName: string; serviceName: string; providerName: string; startsAt: Date; timezone: string; appointmentId: string }
    | null = null;
  try {
    const id = await db().runTransaction(async (trx) => {
      // Resolve location, provider, service, client — all in parallel reads
      const [locSnap, provSnap, svcSnap, cliSnap] = await Promise.all([
        trx.get(tenantCol(ctx.tenant.id, "locations").doc(data.location_id)),
        trx.get(tenantCol(ctx.tenant.id, "providers").doc(data.provider_id)),
        trx.get(tenantCol(ctx.tenant.id, "services").doc(data.service_id)),
        trx.get(tenantCol(ctx.tenant.id, "clients").doc(data.client_id)),
      ]);

      if (!locSnap.exists) throw new Error("Location not found.");
      if (!provSnap.exists) throw new Error("Provider not found.");
      if (!svcSnap.exists) throw new Error("Service not found.");
      if (!cliSnap.exists) throw new Error("Client not found.");

      const loc = locSnap.data() as LocationDoc;
      const prov = provSnap.data() as ProviderDoc;
      const svc = svcSnap.data() as ServiceDoc;
      const cli = cliSnap.data() as ClientDoc;

      if (!loc.is_active) throw new Error("Location is inactive.");
      if (!prov.is_active) throw new Error("Provider is inactive.");
      if (!svc.is_active) throw new Error("Service is inactive.");

      const startsAt = new Date(data.starts_at);
      const endsAt = new Date(startsAt.getTime() + svc.duration_minutes * 60_000);

      // Conflict check — does this provider have an overlapping appointment
      // in an active state? Two intervals overlap when a.starts_at < b.ends_at
      // AND a.ends_at > b.starts_at. Firestore can't AND two range filters on
      // different fields, so we narrow with starts_at then filter ends_at + status
      // in JS. Bounds the query: same provider, scheduled/checked_in/in_progress,
      // starts_at within ±24h of the target (covers any reasonable service length).
      const dayBefore = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
      const dayAfter = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
      const candidates = await trx.get(
        tenantCol(ctx.tenant.id, "appointments")
          .where("provider_id", "==", data.provider_id)
          .where("starts_at", ">=", Timestamp.fromDate(dayBefore))
          .where("starts_at", "<=", Timestamp.fromDate(dayAfter)),
      );
      const ACTIVE: AppointmentDoc["status"][] = ["scheduled", "checked_in", "in_progress"];
      for (const c of candidates.docs) {
        const cd = c.data() as AppointmentDoc;
        if (!ACTIVE.includes(cd.status)) continue;
        const cStart = (cd.starts_at as Timestamp).toDate();
        const cEnd = (cd.ends_at as Timestamp).toDate();
        const overlaps = cStart < endsAt && cEnd > startsAt;
        if (overlaps) {
          throw new Error("Provider already has an appointment that overlaps that time.");
        }
      }

      const ref = tenantCol(ctx.tenant.id, "appointments").doc();
      const doc: Omit<AppointmentDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        client_id: data.client_id,
        provider_id: data.provider_id,
        location_id: data.location_id,
        service: svc.name, // snapshot
        starts_at: Timestamp.fromDate(startsAt),
        ends_at: Timestamp.fromDate(endsAt),
        status: "scheduled",
        notes: data.notes || null,
        chart_id: null,
        confirmation_sms_at: null,
        reminder_sms_at: null,
        cancelled_at: null,
        cancellation_reason: null,
        cancelled_by_user_id: null,
        rescheduled_from_at: null,
        reschedule_count: 0,
        manage_token: null,
        deposit_payment_intent_id: null,
        deposit_payment_id: null,
        deposit_status: "none",
        review_request_sent_at: null,
        rebook_prompt_sent_at: null,
        recurrence_rule: null,
        parent_appointment_id: null,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(ref, doc);
      if (cli.phone && cli.sms_consent !== false) {
        smsBundle = {
          phone: cli.phone,
          tenantName: ctx.tenant.name,
          serviceName: svc.name,
          providerName: prov.full_name,
          startsAt,
          timezone: ctx.tenant.timezone,
          appointmentId: ref.id,
        };
      }
      writeAuditInTx(trx, {
        action: "appointment.create",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "appointment",
        targetId: ref.id,
        after: {
          client: cli.email,
          provider: prov.email,
          service: svc.name,
          starts_at: startsAt.toISOString(),
        },
        ip,
        userAgent: ua,
      });
      return ref.id;
    });

    // Best-effort confirmation SMS (transactional — only sends if owner has
    // Twilio configured AND client has phone + sms_consent !== false).
    const bundle = smsBundle as
      | { phone: string; tenantName: string; serviceName: string; providerName: string; startsAt: Date; timezone: string; appointmentId: string }
      | null;
    if (bundle && (isSmsConfigured() || ctx.tenant.twilio_subaccount_sid)) {
      const tenantId = ctx.tenant.id;
      const tenant = ctx.tenant;
      void (async () => {
        try {
          const result = await sendSmsForTenant(
            tenant,
            bundle.phone,
            buildConfirmationSms({
              tenantName: bundle.tenantName,
              serviceName: bundle.serviceName,
              providerName: bundle.providerName,
              startsAt: bundle.startsAt,
              timezone: bundle.timezone,
            }),
          );
          if (result.ok) {
            await tenantCol(tenantId, "appointments")
              .doc(bundle.appointmentId)
              .update({ confirmation_sms_at: now(), updated_at: now() });
          }
        } catch (err) {
          console.error("[owner-appointments] sms confirm", err);
        }
      })();
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const msg = (err as Error).message;
    let status = 500;
    if (msg.endsWith("not found.")) status = 404;
    else if (msg.includes("overlaps")) status = 409;
    return NextResponse.json({ error: msg }, { status });
  }
}
