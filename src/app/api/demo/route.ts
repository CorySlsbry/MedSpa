/**
 * Aesthera · MedSpa Management Software — public demo / early-access lead capture.
 *
 * Path:
 *   1. Rate-limit by IP.
 *   2. Validate with zod.
 *   3. Outside the transaction: upsert contact (doc ID = lowercased email)
 *      with set/merge — idempotent and free of write contention.
 *   4. Inside a Firestore transaction:
 *        - Find or create the company by name_lower
 *        - Bump company counters
 *        - Insert the lead
 *        - Insert the audit row
 *   5. Side-effects: Resend notify + structured Cloud Log.
 */

import { EMAIL_FROM } from "@/lib/email";

import { NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { checkRateLimit, DEMO_FORM_LIMIT } from "@/lib/rate-limit";
import {
  provisionTenantForOwner,
  generateTenantOwnerSignInLink,
} from "@/lib/tenant";
import { scheduleInfoNurture, sendNurtureEmail } from "@/lib/nurture";
import { enrollContactInWorkflow } from "@/lib/workflows";
import type {
  CompanyDoc,
  CompanyType,
  ContactDoc,
  ContactRole,
  LeadDoc,
  LeadInterest,
  LocationsBucket,
  TenantSubscriptionTier,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTIFY_EMAIL =
  process.env.PLATFORM_DEMO_NOTIFY_EMAIL || "cory.salisbury@gmail.com";

// ── Validation ───────────────────────────────────────────────────────────────

const DemoSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  email: z.string().trim().toLowerCase().email("Email looks invalid.").max(320),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  clinic_name: z.string().trim().min(1, "Clinic name is required.").max(200),
  locations: z.enum(["1", "2-3", "4-9", "10+"]).default("1"),
  role: z
    .enum(["owner", "medical_director", "manager", "provider", "other"])
    .default("owner"),
  // info  → "more info" form: nurture sequence, no provision
  // demo  → kept for back-compat (the form no longer surfaces this; the
  //         BookingModal owns demo intent now). Routes to booking email.
  // early_access → trial provision (admin-blocked)
  // pricing → pricing-info reply
  interest: z.enum(["info", "demo", "early_access", "pricing"]).default("info"),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  utm_source: z.string().trim().max(100).optional(),
  utm_medium: z.string().trim().max(100).optional(),
  utm_campaign: z.string().trim().max(200).optional(),
  // Honeypot — bots tend to fill this; humans never see it.
  website: z.string().max(0).optional().or(z.literal("")),
});

type DemoBody = z.infer<typeof DemoSchema>;

function inferCompanyType(clinicName: string): CompanyType {
  const n = clinicName.toLowerCase();
  if (/\biv\b|drip|hydration|infus/.test(n)) return "iv_lounge";
  if (/lash|brow/.test(n)) return "lash_brow_studio";
  if (/head\s*spa/.test(n)) return "head_spa";
  if (/wellness|holistic|recovery/.test(n)) return "wellness_studio";
  if (/aesthetic|derm|beauty|skin/.test(n)) return "aesthetic_clinic";
  if (/spa|med\s*spa|medspa/.test(n)) return "med_spa";
  return "unknown";
}

// ── Resend notification (best-effort) ────────────────────────────────────────

async function emailCory(
  body: DemoBody,
  ids: { leadId: string; contactId: string; companyId: string },
  provisionResult: Awaited<ReturnType<typeof provisionTenantForOwner>> | null,
): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log("[platform-demo] notify (no resend key)", { ...body, ids });
    return;
  }
  const interestLabel: Record<DemoBody["interest"], string> = {
    info: "More info / nurture",
    demo: "15-min demo",
    early_access: "🔥 Founding-25 spot",
    pricing: "Pricing details",
  };
  const subject =
    body.interest === "early_access"
      ? `🔥 Founding-25 inquiry — ${body.clinic_name}`
      : `New Aesthera demo — ${body.clinic_name}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM.leads,
        to: [NOTIFY_EMAIL],
        subject,
        html: `
          <h2>Aesthera — new lead</h2>
          <p><strong>Interest:</strong> ${interestLabel[body.interest]}</p>
          <p><strong>Name:</strong> ${escapeHtml(body.name)}</p>
          <p><strong>Email:</strong> <a href="mailto:${escapeHtml(body.email)}">${escapeHtml(body.email)}</a></p>
          <p><strong>Phone:</strong> ${escapeHtml(body.phone || "—")}</p>
          <p><strong>Clinic:</strong> ${escapeHtml(body.clinic_name)}</p>
          <p><strong>Locations:</strong> ${body.locations}</p>
          <p><strong>Role:</strong> ${body.role}</p>
          ${body.notes ? `<p><strong>Notes:</strong></p><blockquote style="border-left:3px solid #07667A;padding-left:12px;color:#2e4057;">${escapeHtml(body.notes).replace(/\n/g, "<br>")}</blockquote>` : ""}
          ${provisionResult ? `<p style="background:#f3f9f4;border-left:3px solid #198754;padding:10px 12px;color:#0f4d2c;border-radius:6px;"><strong>Auto-provisioned</strong> as tenant <code>${escapeHtml(provisionResult.slug)}</code> ${provisionResult.alreadyExisted ? "(existing tenant — magic link refreshed)" : "(new 14-day trial — magic link sent)"}.</p>` : `<p style="background:#fff7e6;border-left:3px solid #d97706;padding:10px 12px;color:#7a3e00;border-radius:6px;"><strong>Note:</strong> auto-provisioning failed — provision manually from <a href="${process.env.NEXT_PUBLIC_SITE_URL || ""}/admin/tenants">/admin/tenants</a>.</p>`}
          <hr>
          <p style="font-size:12px;color:#888;">
            Lead ID: ${ids.leadId} · Contact: ${ids.contactId} · Company: ${ids.companyId}<br>
            <a href="${process.env.NEXT_PUBLIC_SITE_URL || ""}/admin/leads/${ids.leadId}">Open in CRM →</a>
          </p>
        `,
      }),
    });
    if (!res.ok) {
      console.error("[platform-demo] resend notify failed", res.status, await res.text());
    }
  } catch (err) {
    console.error("[platform-demo] resend notify error", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // 1. Rate limit
  const ip = getIp(req);
  const rl = checkRateLimit(`demo:${ip}`, DEMO_FORM_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rl.resetMs / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // 2. Parse + validate
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = DemoSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  // Honeypot — silently 200 so bots don't learn they hit one
  if (parsed.data.website && parsed.data.website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const data = parsed.data;
  const ua = req.headers.get("user-agent") || null;

  // 3. Persist
  let ids: { leadId: string; contactId: string; companyId: string };
  try {
    ids = await persistLead(data, ip, ua);
  } catch (err) {
    console.error("[platform-demo] DB write failed", err);
    return NextResponse.json(
      { error: "Could not save your request. Try again or email person1@example.com." },
      { status: 500 },
    );
  }

  // 4. Intent-based branching.
  //
  //   early_access → AUTO-PROVISION trial tenant + welcome email with magic link.
  //                  This is the explicit "claim a founding-25 spot" path.
  //   demo         → DO NOT provision. Send a "book a time on Cory's calendar"
  //                  email and surface the booking URL in the response.
  //   pricing      → DO NOT provision. Send pricing-info reply, capture lead.
  //
  //   The provisioner also hard-refuses if the email is on the admin allowlist
  //   (see provisionTenantForOwner) — defense in depth.
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;
  const bookingUrl = process.env.PLATFORM_DEMO_BOOKING_URL || null;

  let provisionResult: Awaited<ReturnType<typeof provisionTenantForOwner>> | null = null;
  let provisionError: string | null = null;

  if (data.interest === "early_access") {
    try {
      provisionResult = await provisionTenantForOwner({
        clinicName: data.clinic_name,
        clinicType: inferCompanyType(data.clinic_name),
        ownerEmail: data.email,
        ownerFullName: data.name,
        subscriptionTier: "founding_25",
        timezone: "America/Denver",
        trialDays: 14,
      });
    } catch (err) {
      // Capture the reason but don't fail the request — lead is already saved.
      const msg = (err as { message?: string }).message ?? String(err);
      provisionError = msg;
      console.error("[platform-demo] auto-provision failed", err);
    }

    if (provisionResult) {
      sendTrialWelcomeEmail({
        ownerEmail: data.email,
        ownerName: data.name,
        clinicName: provisionResult.tenant.name,
        alreadyExisted: provisionResult.alreadyExisted,
        baseUrl,
      }).catch((err) => console.error("[platform-demo] trial welcome email failed", err));
    }
  } else if (data.interest === "demo") {
    // Legacy path — surface a booking email reply. Live form now uses the
    // BookingModal (POST /api/demo/book) directly.
    sendDemoBookingEmail({
      ownerEmail: data.email,
      ownerName: data.name,
      clinicName: data.clinic_name,
      bookingUrl,
    }).catch((err) => console.error("[platform-demo] booking email failed", err));
  } else if (data.interest === "pricing") {
    sendPricingInfoEmail({
      ownerEmail: data.email,
      ownerName: data.name,
      clinicName: data.clinic_name,
      bookingUrl,
    }).catch((err) => console.error("[platform-demo] pricing email failed", err));
  } else {
    // info — fire Day 0 of the nurture sequence immediately, schedule Day 2
    // and Day 4 for the cron to send. Refuse to send to admin emails.
    const isAdmin = (process.env.ADMIN_BOOTSTRAP_EMAIL || "")
      .toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .includes(data.email.toLowerCase());
    if (!isAdmin) {
      // Day 0 sends immediately. Create a scheduled_emails row first so the
      // Resend webhook can correlate open/click events back to a tracked
      // doc, then fire the send with that doc id as the tag.
      void (async () => {
        try {
          const seRef = db().collection("scheduled_emails").doc();
          await seRef.set({
            type: "info_nurture",
            step: "day_0",
            recipient_email: data.email,
            recipient_name: data.name,
            clinic_name: data.clinic_name,
            scheduled_at: now(),
            status: "queued",
            sent_at: null,
            error: null,
            created_at: now(),
          });
          const result = await sendNurtureEmail({
            step: "day_0",
            recipientEmail: data.email,
            recipientName: data.name,
            clinicName: data.clinic_name,
            scheduledEmailId: seRef.id,
          });
          if (result.ok) {
            await seRef.update({
              status: "sent",
              sent_at: now(),
              resend_id: result.resendId ?? null,
            });
          } else {
            await seRef.update({ status: "failed", error: result.error ?? "unknown" });
          }
        } catch (err) {
          console.error("[platform-demo] day_0 nurture failed", err);
        }
      })();

      void scheduleInfoNurture({
        recipientEmail: data.email,
        recipientName: data.name,
        clinicName: data.clinic_name,
        bookingUrl,
      }).catch((err) => console.error("[platform-demo] schedule nurture failed", err));

      void tagContactForNurture(data.email, data.name, data.clinic_name).catch((err) =>
        console.error("[platform-demo] nurture tag failed", err),
      );

      // Register the contact as enrolled in the visible WorkflowDoc so the
      // active_enrollments + per-step counters update on /admin/workflows.
      // The actual sends are still driven by nurture.ts + scheduled_emails;
      // this enrollment is the operator-facing source of truth.
      void enrollContactInWorkflow({
        workflowId: "aesthera-inbound-nurture",
        contactId: data.email,
        source: { type: "lead", leadId: ids.leadId },
        actorEmail: "marketing-form",
        ip,
        userAgent: ua,
      }).catch((err) =>
        console.error("[platform-demo] workflow enrollment failed", err),
      );
    }
  }

  // 5. Internal notify to Cory (always)
  emailCory(data, ids, provisionResult).catch((err) =>
    console.error("[platform-demo] email side-effect error", err),
  );

  console.log(
    JSON.stringify({
      event: "platform_demo",
      ts: new Date().toISOString(),
      lead_id: ids.leadId,
      interest: data.interest,
      role: data.role,
      locations: data.locations,
      email_domain: data.email.split("@")[1] ?? null,
      auto_provisioned: provisionResult !== null,
      tenant_slug: provisionResult?.slug ?? null,
      tenant_already_existed: provisionResult?.alreadyExisted ?? null,
      provision_error: provisionError,
    }),
  );

  return NextResponse.json({
    ok: true,
    intent: data.interest,
    auto_provisioned: provisionResult !== null,
    tenant_slug: provisionResult?.slug ?? null,
    tenant_already_existed: provisionResult?.alreadyExisted ?? null,
    booking_url: data.interest === "demo" ? bookingUrl : null,
  });
}

// ── Intent-specific email senders ────────────────────────────────────────────
//
// Three flavors keyed off DemoBody.interest:
//   - sendTrialWelcomeEmail  (early_access only) — magic-link sign-in
//   - sendDemoBookingEmail   (demo)               — Cory's calendar link
//   - sendPricingInfoEmail   (pricing)            — pricing details + reply CTA

async function sendTrialWelcomeEmail(args: {
  ownerEmail: string;
  ownerName: string;
  clinicName: string;
  alreadyExisted: boolean;
  baseUrl: string;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log("[platform-demo] trial-welcome (no resend key)", args);
    return;
  }
  const link = await generateTenantOwnerSignInLink(args.ownerEmail, args.baseUrl);
  const firstName = args.ownerName.split(/\s+/)[0] || "there";
  const subject = args.alreadyExisted
    ? `Aesthera — your sign-in link for ${args.clinicName}`
    : `Welcome to Aesthera — your founding-25 trial is live`;
  const intro = args.alreadyExisted
    ? `Welcome back. Click below to sign in to <strong>${escapeHtml(args.clinicName)}</strong>.`
    : `Your 14-day Aesthera trial is ready — locked in at the founding-25 rate. Click below to sign in to <strong>${escapeHtml(args.clinicName)}</strong> and start setting up.`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.support,
      to: [args.ownerEmail],
      subject,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1b2636">
          <p>Hi ${escapeHtml(firstName)},</p>
          <p>${intro}</p>
          <p style="margin:28px 0">
            <a href="${link}"
               style="display:inline-block;padding:14px 28px;background:#b98f42;color:#1b2636;
                      text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
              Sign in to Aesthera →
            </a>
          </p>
          <p style="font-size:12px;color:#888">
            Link expires in 15 minutes. If it expires, just resubmit the form on aesthera.io and we'll send a fresh one.
          </p>
          <p style="font-size:12px;color:#888;margin-top:24px">
            Aesthera · MedSpa Management Software<br>
            Reply to this email if you need anything — it goes straight to the team.
          </p>
        </div>
      `,
    }),
  });
  if (!res.ok) {
    console.error("[platform-demo] trial-welcome resend failed", res.status, await res.text());
  }
}

async function sendDemoBookingEmail(args: {
  ownerEmail: string;
  ownerName: string;
  clinicName: string;
  bookingUrl: string | null;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log("[platform-demo] booking email (no resend key)", args);
    return;
  }
  const firstName = args.ownerName.split(/\s+/)[0] || "there";
  const cta = args.bookingUrl
    ? `<a href="${args.bookingUrl}" style="display:inline-block;padding:14px 28px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">Pick a 15-minute slot →</a>`
    : `<p style="color:#7a3e00">Cory will reply shortly with a calendar link.</p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.support,
      to: [args.ownerEmail],
      reply_to: process.env.PLATFORM_DEMO_NOTIFY_EMAIL || "person2@example.com",
      subject: `Aesthera — let's book your ${escapeHtml(args.clinicName)} demo`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1b2636">
          <p>Hi ${escapeHtml(firstName)},</p>
          <p>Thanks for asking about Aesthera. The fastest way for me to show what's actually different about it — instead of you reading another comparison page — is a 15-minute screen share.</p>
          <p>Pick a time that works for you:</p>
          <p style="margin:28px 0">${cta}</p>
          <p>If those times don't work, just reply to this email with what does and I'll make it happen.</p>
          <p style="font-size:12px;color:#888;margin-top:24px">
            — Cory<br>
            Aesthera · MedSpa Management Software
          </p>
        </div>
      `,
    }),
  });
  if (!res.ok) {
    console.error("[platform-demo] booking email resend failed", res.status, await res.text());
  }
}

async function sendPricingInfoEmail(args: {
  ownerEmail: string;
  ownerName: string;
  clinicName: string;
  bookingUrl: string | null;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log("[platform-demo] pricing email (no resend key)", args);
    return;
  }
  const firstName = args.ownerName.split(/\s+/)[0] || "there";
  const callCta = args.bookingUrl
    ? `<p style="margin:20px 0"><a href="${args.bookingUrl}" style="display:inline-block;padding:12px 22px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:8px;font-weight:600">Book a 15-min walkthrough →</a></p>`
    : "";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.support,
      to: [args.ownerEmail],
      reply_to: process.env.PLATFORM_DEMO_NOTIFY_EMAIL || "person2@example.com",
      subject: `Aesthera — pricing for ${escapeHtml(args.clinicName)}`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1b2636">
          <p>Hi ${escapeHtml(firstName)},</p>
          <p>Quick rundown — Aesthera pricing is per-platform, not per-seat:</p>
          <ul style="line-height:1.7">
            <li><strong>Founding-25 · $99/mo for life</strong> — first 25 clinics. Everything in Growth, locked.</li>
            <li><strong>Basic · $199/mo</strong> — solo / single-location. 1 location, ≤3 providers, 1k clients.</li>
            <li><strong>Growth · $399/mo</strong> — 5 locations, unlimited providers, 10k clients, Stripe Connect.</li>
            <li><strong>Enterprise · $899/mo</strong> — unlimited everything, SSO, dedicated CSM, custom integrations.</li>
          </ul>
          <p>14-day free trial on every tier. Annual prepay saves 15%.</p>
          ${callCta}
          <p>Reply with any specific questions about how it'd fit ${escapeHtml(args.clinicName)} — happy to dig in.</p>
          <p style="font-size:12px;color:#888;margin-top:24px">
            — Cory<br>
            Aesthera · MedSpa Management Software
          </p>
        </div>
      `,
    }),
  });
  if (!res.ok) {
    console.error("[platform-demo] pricing email resend failed", res.status, await res.text());
  }
}

/**
 * Tag the contact for the inbound info nurture sequence. The tag is what
 * the marketing-scan cron picks up to send the Day 2 + Day 4 emails.
 *
 * TODO: when we wire a proper "Aesthera Inbound Nurture" workflow with steps,
 * call enrollContactInWorkflow() instead of just tagging. The tag-only path
 * is enough to ship today.
 */
async function tagContactForNurture(email: string, _name: string, _clinic: string): Promise<void> {
  void _name; void _clinic;
  const ref = db().collection("contacts").doc(email);
  const snap = await ref.get();
  if (!snap.exists) return;
  const cur = snap.data() as ContactDoc;
  const tags = Array.isArray(cur.tags) ? cur.tags : [];
  const NURTURE_TAG = "aesthera-inbound-nurture";
  if (tags.includes(NURTURE_TAG)) return;
  await ref.update({
    tags: [...tags, NURTURE_TAG],
    updated_at: now(),
  });
}

async function persistLead(
  data: DemoBody,
  ip: string | null,
  ua: string | null,
): Promise<{ leadId: string; contactId: string; companyId: string }> {
  const firestore = db();
  const contactId = data.email; // doc ID = lowercased email

  // Step A — upsert the contact (outside the company-lead transaction).
  // Idempotent thanks to merge:true. Race-safe enough at our volume.
  const contactRef = firestore.collection("contacts").doc(contactId);
  const existingContact = await contactRef.get();
  const isNewContact = !existingContact.exists;

  const contactWrite: Partial<ContactDoc> = {
    email: data.email,
    full_name: data.name,
    phone: data.phone || null,
    role: (data.role as ContactRole) ?? null,
    source: "marketing_site",
    updated_at: now() as never,
  };
  if (isNewContact) {
    contactWrite.do_not_contact = false;
    contactWrite.email_unsubscribed = false;
    contactWrite.sms_unsubscribed = false;
    contactWrite.tags = [];
    contactWrite.created_at = now() as never;
  }
  await contactRef.set(contactWrite, { merge: true });

  // Step B — transactional: company upsert + lead insert + audit insert
  const result = await firestore.runTransaction(async (trx) => {
    const inferredType = inferCompanyType(data.clinic_name);
    const locationsBucket = data.locations as LocationsBucket;
    const nameLower = data.clinic_name.toLowerCase();

    // Find existing company by name_lower
    const companyQuery = await trx.get(
      firestore.collection("companies").where("name_lower", "==", nameLower).limit(1),
    );
    let companyId: string;
    let companyType: CompanyType;
    let companyLocs: LocationsBucket | null;

    if (companyQuery.empty) {
      const newRef = firestore.collection("companies").doc();
      companyId = newRef.id;
      companyType = inferredType;
      companyLocs = locationsBucket;
      const newCompany: Omit<CompanyDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        name: data.clinic_name,
        name_lower: nameLower,
        type: inferredType,
        website: null,
        location_city: null,
        location_state: null,
        location_country: "US",
        locations_count: locationsBucket,
        source: "marketing_site",
        notes: null,
        contact_count: isNewContact ? 1 : 0,
        lead_count: 1,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(newRef, newCompany);
    } else {
      const existing = companyQuery.docs[0];
      companyId = existing.id;
      const existingData = existing.data() as CompanyDoc;
      companyType = existingData.type;
      companyLocs = existingData.locations_count;

      const updates: Record<string, unknown> = {
        lead_count: FieldValue.increment(1),
        updated_at: now(),
      };
      if (isNewContact) {
        updates.contact_count = FieldValue.increment(1);
      }
      // Promote unknown type if we have a better inference
      if (existingData.type === "unknown" && inferredType !== "unknown") {
        updates.type = inferredType;
        companyType = inferredType;
      }
      // Fill locations if unset
      if (
        !existingData.locations_count ||
        existingData.locations_count === "unknown"
      ) {
        updates.locations_count = locationsBucket;
        companyLocs = locationsBucket;
      }
      trx.update(existing.ref, updates);
    }

    // Update contact's company_id + company_name back-link (denormalize)
    trx.update(contactRef, {
      company_id: companyId,
      company_name: data.clinic_name,
      updated_at: now(),
    });

    // Insert the lead
    const leadRef = firestore.collection("leads").doc();
    const leadDoc: Omit<LeadDoc, "created_at" | "updated_at"> & {
      created_at: ReturnType<typeof now>;
      updated_at: ReturnType<typeof now>;
    } = {
      contact_id: contactId,
      contact: {
        email: data.email,
        full_name: data.name,
        phone: data.phone || null,
        role: (data.role as ContactRole) ?? null,
      },
      company_id: companyId,
      company: {
        name: data.clinic_name,
        type: companyType,
        locations_count: companyLocs,
      },
      source: "marketing_site",
      interest: data.interest as LeadInterest,
      status: "new",
      raw_payload: data as Record<string, unknown>,
      utm_source: data.utm_source || null,
      utm_medium: data.utm_medium || null,
      utm_campaign: data.utm_campaign || null,
      notes: data.notes || null,
      ip,
      user_agent: ua,
      // Marketing-site leads don't carry Apollo or LinkedIn IDs — we only
      // know email + name + clinic. Compute the qualifiers we can.
      email_normalized: data.email.trim().toLowerCase(),
      phone_digits: data.phone
        ? data.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
        : null,
      linkedin_normalized: null,
      name_company_key: null, // marketing form gives us full_name only; Jarvis builds keys
      apollo_person_id: null,
      external_id: null,
      deleted_at: null,
      created_at: now(),
      updated_at: now(),
    };
    trx.create(leadRef, leadDoc);

    // Audit
    writeAuditInTx(trx, {
      action: "lead.create",
      actorEmail: data.email,
      targetType: "lead",
      targetId: leadRef.id,
      after: {
        lead_id: leadRef.id,
        contact_id: contactId,
        company_id: companyId,
        interest: data.interest,
      },
      ip,
      userAgent: ua,
    });

    return { leadId: leadRef.id, contactId, companyId };
  });

  return result;
}

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}
