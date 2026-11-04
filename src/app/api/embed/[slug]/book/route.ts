/**
 * POST /api/embed/[slug]/book
 *
 * Public booking endpoint. Creates a tentative appointment without any
 * authentication. Anyone with the URL can book.
 *
 * Steps:
 *   1. Rate limit per IP (12/hr) and per email (5/hr)
 *   2. Validate input (zod)
 *   3. Resolve tenant (404 if cancelled)
 *   4. Resolve service + location (must be active, must belong to tenant)
 *   5. Pick the first available active provider at this location
 *   6. Verify the slot is still free (transactional overlap check)
 *   7. Find-or-create the client by email (within tenant)
 *   8. Insert appointment with status='scheduled'
 *   9. Audit (using actor_email = the booking email)
 *  10. Best-effort: notify clinic owner via Resend; confirm to client
 *
 * SECURITY NOTES:
 *  - This is a public, unauthenticated endpoint by design.
 *  - We don't accept any internal IDs except the public service_id and
 *    location_id (which are scoped to the tenant by the path).
 *  - Email enumeration is OK here — booking is a public-by-design feature.
 *  - Rate limits + zod + transactional conflict detection block abuse.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { getTenant, tenantCol } from "@/lib/tenant";
import { writeAuditInTx } from "@/lib/audit";
import { createPayment } from "@/lib/payments";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendSmsForTenant, buildConfirmationSms, isSmsConfigured } from "@/lib/sms";
import { EMAIL_FROM } from "@/lib/email";
import type {
  AppointmentDoc,
  ClientDoc,
  LocationDoc,
  ProviderDoc,
  ServiceDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  service_id: z.string().trim().min(1),
  location_id: z.string().trim().min(1),
  starts_at: z.string().datetime(),
  client: z.object({
    email: z.string().trim().toLowerCase().email().max(320),
    full_name: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(40).optional(),
  }),
  notes: z.string().trim().max(2000).optional(),
});

const PER_IP = { capacity: 12, windowMs: 60 * 60 * 1000 };
const PER_EMAIL = { capacity: 5, windowMs: 60 * 60 * 1000 };

export async function POST(
  req: Request,
  rctx: { params: Promise<{ slug: string }> },
) {
  const ip = getIp(req);
  const ua = req.headers.get("user-agent") || null;
  const { slug } = await rctx.params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400, headers: corsHeaders() });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400, headers: corsHeaders() },
    );
  }
  const data = parsed.data;

  // Rate limit
  if (ip) {
    const rlIp = checkRateLimit(`embed-book:ip:${ip}`, PER_IP);
    if (!rlIp.allowed) {
      return NextResponse.json(
        { error: "Too many bookings from this network. Try again later." },
        { status: 429, headers: corsHeaders() },
      );
    }
  }
  const rlEmail = checkRateLimit(`embed-book:email:${data.client.email}`, PER_EMAIL);
  if (!rlEmail.allowed) {
    return NextResponse.json(
      { error: "Too many booking attempts for that email." },
      { status: 429, headers: corsHeaders() },
    );
  }

  const tenant = await getTenant(slug);
  if (!tenant || tenant.subscription_status === "cancelled") {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: corsHeaders() });
  }

  type BookResult = {
    appointmentId: string;
    clientId: string;
    providerName: string;
    serviceName: string;
    locationName: string;
    startsAt: Date;
    depositCents: number | null;
  };
  let result: BookResult;
  try {
    result = await db().runTransaction<BookResult>(async (trx) => {
      // Resolve service, location
      const [svcSnap, locSnap] = await Promise.all([
        trx.get(tenantCol(slug, "services").doc(data.service_id)),
        trx.get(tenantCol(slug, "locations").doc(data.location_id)),
      ]);
      if (!svcSnap.exists) throw new Error("Service not found.");
      if (!locSnap.exists) throw new Error("Location not found.");
      const svc = svcSnap.data() as ServiceDoc;
      const loc = locSnap.data() as LocationDoc;
      if (!svc.is_active) throw new Error("Service unavailable.");
      if (!loc.is_active) throw new Error("Location unavailable.");

      const startsAt = new Date(data.starts_at);
      const endsAt = new Date(startsAt.getTime() + svc.duration_minutes * 60_000);
      if (startsAt.getTime() < Date.now() + 30 * 60_000) {
        throw new Error("That slot is too soon — pick something at least 30 minutes from now.");
      }

      // Pick a provider — first active, prefer ones whose default_location matches
      const provSnap = await trx.get(
        tenantCol(slug, "providers").where("is_active", "==", true).limit(20),
      );
      if (provSnap.empty) throw new Error("No providers available at this clinic yet.");
      const candidates = provSnap.docs
        .map((d) => ({ id: d.id, data: d.data() as ProviderDoc }))
        .sort((a, b) => {
          const aPref = a.data.default_location_id === data.location_id ? 0 : 1;
          const bPref = b.data.default_location_id === data.location_id ? 0 : 1;
          return aPref - bPref;
        });

      // For each candidate, check conflicts
      let chosenProvider: { id: string; data: ProviderDoc } | null = null;
      for (const c of candidates) {
        const dayBefore = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
        const dayAfter = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
        const conflictSnap = await trx.get(
          tenantCol(slug, "appointments")
            .where("provider_id", "==", c.id)
            .where("starts_at", ">=", Timestamp.fromDate(dayBefore))
            .where("starts_at", "<=", Timestamp.fromDate(dayAfter)),
        );
        const ACTIVE: AppointmentDoc["status"][] = ["scheduled", "checked_in", "in_progress"];
        let conflicts = false;
        for (const d of conflictSnap.docs) {
          const ad = d.data() as AppointmentDoc;
          if (!ACTIVE.includes(ad.status)) continue;
          const cs = (ad.starts_at as Timestamp).toDate();
          const ce = (ad.ends_at as Timestamp).toDate();
          if (cs < endsAt && ce > startsAt) {
            conflicts = true;
            break;
          }
        }
        if (!conflicts) {
          chosenProvider = c;
          break;
        }
      }
      if (!chosenProvider) {
        throw new Error("That time just got taken — please pick another slot.");
      }

      // Find or create client by email
      const clientQuery = await trx.get(
        tenantCol(slug, "clients").where("email", "==", data.client.email).limit(1),
      );
      let clientId: string;
      if (clientQuery.empty) {
        const clientRef = tenantCol(slug, "clients").doc();
        clientId = clientRef.id;
        const clientDoc: Omit<ClientDoc, "created_at" | "updated_at"> & {
          created_at: ReturnType<typeof now>;
          updated_at: ReturnType<typeof now>;
        } = {
          tenant_id: slug,
          email: data.client.email,
          full_name: data.client.full_name,
          phone: data.client.phone || null,
          date_of_birth: null,
          preferred_name: null,
          default_location_id: data.location_id,
          email_consent: true, // they're booking — implied transactional consent
          sms_consent: false,
          hipaa_consent_signed_at: null,
          tags: ["booked-via-embed"],
          created_at: now(),
          updated_at: now(),
        };
        trx.create(clientRef, clientDoc);
      } else {
        clientId = clientQuery.docs[0].id;
        // Update display name + phone if filled in by the client this time
        trx.update(clientQuery.docs[0].ref, {
          full_name: data.client.full_name,
          phone: data.client.phone || (clientQuery.docs[0].data() as ClientDoc).phone,
          updated_at: now(),
        });
      }

      // Insert appointment
      const apptRef = tenantCol(slug, "appointments").doc();
      const managementToken = randomBytes(24).toString("base64url");
      const apptDoc: Omit<AppointmentDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: slug,
        client_id: clientId,
        provider_id: chosenProvider.id,
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
        manage_token: managementToken,
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
      trx.create(apptRef, apptDoc);

      writeAuditInTx(trx, {
        action: "embed.book",
        actorEmail: data.client.email,
        targetType: "appointment",
        targetId: apptRef.id,
        after: {
          tenant_id: slug,
          service: svc.name,
          location: loc.name,
          provider: chosenProvider.data.full_name,
          starts_at: startsAt.toISOString(),
        },
        ip,
        userAgent: ua,
      });

      return {
        appointmentId: apptRef.id,
        clientId,
        providerName: chosenProvider.data.full_name,
        serviceName: svc.name,
        locationName: loc.name,
        startsAt,
        depositCents: svc.deposit_cents ?? null,
      };
    });
  } catch (err) {
    const msg = (err as Error).message;
    let status = 500;
    if (msg.includes("not found")) status = 404;
    else if (msg.includes("unavailable") || msg.includes("too soon") || msg.includes("just got taken")) status = 409;
    return NextResponse.json({ error: msg }, { status, headers: corsHeaders() });
  }

  // ─── Deposit (Phase 6.2) ────────────────────────────────────────────────
  // If the booked service requires a deposit AND the tenant has live
  // Connect charges, create a manual-capture PaymentIntent and persist
  // it on the appointment. Returns deposit_client_secret in the response
  // so the embed widget can confirm via Stripe Elements.
  let depositClientSecret: string | null = null;
  let depositAmountCents: number | null = null;
  if (
    result.depositCents &&
    result.depositCents > 0 &&
    tenant.stripe_connect_charges_enabled &&
    tenant.stripe_connect_account_id
  ) {
    try {
      const pay = await createPayment({
        tenant,
        kind: "deposit",
        amountCents: result.depositCents,
        captureMethod: "manual",
        clientId: result.clientId,
        receiptEmail: data.client.email,
        refType: "appointment",
        refId: result.appointmentId,
        description: `Deposit · ${result.serviceName}`,
      });
      await tenantCol(slug, "appointments").doc(result.appointmentId).update({
        deposit_payment_intent_id: pay.paymentIntentId,
        deposit_payment_id: pay.paymentDocId,
        deposit_status: "held",
        updated_at: now(),
      });
      depositClientSecret = pay.clientSecret;
      depositAmountCents = pay.amountCents;
    } catch (err) {
      console.error("[embed-book] deposit create", err);
      await tenantCol(slug, "appointments").doc(result.appointmentId).update({
        deposit_status: "failed",
        updated_at: now(),
      });
    }
  }

  // Side-effects (best-effort)
  notifyOwnerOfBooking(tenant.owner_email, tenant.name, data.client, result).catch((err) =>
    console.error("[embed-book] owner notify", err),
  );
  confirmToClient(data.client.email, data.client.full_name, tenant.name, tenant.owner_email, result).catch((err) =>
    console.error("[embed-book] client confirm", err),
  );

  // Best-effort SMS confirmation (only if client provided phone + SMS is configured)
  if (data.client.phone && (isSmsConfigured() || tenant.twilio_subaccount_sid)) {
    void (async () => {
      try {
        const smsResult = await sendSmsForTenant(
          tenant,
          data.client.phone!,
          buildConfirmationSms({
            tenantName: tenant.name,
            serviceName: result.serviceName,
            providerName: result.providerName,
            startsAt: result.startsAt,
            timezone: tenant.timezone,
          }),
        );
        if (smsResult.ok) {
          await tenantCol(slug, "appointments")
            .doc(result.appointmentId)
            .update({ confirmation_sms_at: now(), updated_at: now() });
        }
      } catch (err) {
        console.error("[embed-book] sms confirm", err);
      }
    })();
  }

  return new NextResponse(
    JSON.stringify({
      ok: true,
      appointment_id: result.appointmentId,
      service: result.serviceName,
      provider: result.providerName,
      location: result.locationName,
      deposit_required: depositClientSecret !== null,
      deposit_client_secret: depositClientSecret,
      deposit_amount_cents: depositAmountCents,
      stripe_account_id: depositClientSecret ? tenant.stripe_connect_account_id : null,
      stripe_publishable_key: depositClientSecret
        ? process.env.STRIPE_PUBLISHABLE_KEY ?? null
        : null,
    }),
    { status: 200, headers: corsHeaders() },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}

async function notifyOwnerOfBooking(
  ownerEmail: string,
  tenantName: string,
  client: { email: string; full_name: string; phone?: string },
  result: { providerName: string; serviceName: string; appointmentId: string; locationName: string },
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[embed-book] (no resend key) booking", result.appointmentId, "for", ownerEmail);
    return;
  }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.default,
      to: [ownerEmail],
      subject: `New booking · ${result.serviceName} · ${tenantName}`,
      html: `
        <h2>New booking</h2>
        <p><strong>${client.full_name}</strong> booked ${result.serviceName} with ${result.providerName} at ${result.locationName}.</p>
        <p>Email: ${client.email}${client.phone ? ` · Phone: ${client.phone}` : ""}</p>
        <p style="font-size:12px;color:#888;">Appointment ID: ${result.appointmentId}</p>
      `,
    }),
  });
}

async function confirmToClient(
  email: string,
  fullName: string,
  tenantName: string,
  ownerEmail: string,
  result: { providerName: string; serviceName: string; locationName: string },
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.default,
      to: [email],
      reply_to: ownerEmail,
      subject: `${tenantName} — your appointment is booked`,
      html: `
        <p>Hi ${fullName.split(" ")[0]},</p>
        <p>Your appointment at <strong>${tenantName}</strong> is booked.</p>
        <p><strong>${result.serviceName}</strong> with ${result.providerName} at ${result.locationName}.</p>
        <p>Need to reschedule? Reply to this email.</p>
        <p style="font-size:12px;color:#888;margin-top:24px">Aesthera · MedSpa Management Software</p>
      `,
    }),
  });
}
