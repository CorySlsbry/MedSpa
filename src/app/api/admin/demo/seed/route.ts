/**
 * POST /api/admin/demo/seed
 *
 * Super-admin only. Provisions a fully-populated demo tenant — the
 * "Aesthera Demo Med Spa" — with 6 Firebase Auth users (1 owner + 1
 * manager + 2 providers + 2 front-desk), 2 locations, ~12 services,
 * ~7 products, ~35 clients, ~115 appointments (60 days past + 14 future),
 * ~30 charts, ~40 leads, ~60 campaign runs, all on the enterprise tier.
 *
 * Idempotent: if the tenant already exists, returns its current state +
 * the saved seed credentials so super-admin can replay them.
 *
 * The tenant's slug is `aesthera-demo` and emails live under
 * demo.aesthera.io. Demo credentials are persisted in the tenant doc
 * under `demo_credentials` so a re-seed reveals the same passwords.
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getSessionUser } from "@/lib/auth-server";
import { db, now } from "@/lib/firestore";
import { tenantCol } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import {
  buildDemoSeed,
  DEMO_TENANT_SLUG,
  DEMO_TENANT_NAME,
  type SeedUser,
} from "@/lib/demo-seed";
import type { TenantDoc, AppointmentStatus } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function init() {
  if (getApps().length > 0) return;
  const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saB64) {
    try {
      initializeApp({
        credential: cert(JSON.parse(Buffer.from(saB64, "base64").toString("utf8"))),
      });
      return;
    } catch {
      /* fallthrough */
    }
  }
  initializeApp({ credential: applicationDefault() });
}

export async function POST() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  init();

  // Already exists? Return the current state.
  const existingSnap = await db().collection("tenants").doc(DEMO_TENANT_SLUG).get();
  if (existingSnap.exists) {
    const data = existingSnap.data() as TenantDoc & { demo_credentials?: SeedUser[] };
    return NextResponse.json({
      ok: true,
      already: true,
      slug: DEMO_TENANT_SLUG,
      name: data.name,
      credentials: data.demo_credentials ?? [],
      message: "Demo tenant already exists. Tear it down first to re-seed.",
    });
  }

  const seed = buildDemoSeed();

  // ── 1. Create Firebase Auth users + set custom claims ────────────────────
  const userIdByEmail = new Map<string, string>();
  for (const u of seed.users) {
    let uid: string;
    try {
      const created = await getAuth().createUser({
        email: u.email,
        password: u.password,
        displayName: u.fullName,
        emailVerified: true,
      });
      uid = created.uid;
    } catch (err) {
      // If the user already exists from a previous partial seed, look it up
      const existing = await getAuth().getUserByEmail(u.email).catch(() => null);
      if (!existing) {
        return NextResponse.json(
          { error: `Couldn't create demo user ${u.email}: ${err instanceof Error ? err.message : err}` },
          { status: 500 },
        );
      }
      uid = existing.uid;
    }
    userIdByEmail.set(u.email, uid);
    await getAuth().setCustomUserClaims(uid, {
      tenant_id: DEMO_TENANT_SLUG,
      role: u.role,
    });
    // Mirror the UserDoc (display_name + role + last_seen)
    await db().collection("users").doc(uid).set({
      email: u.email,
      display_name: u.fullName,
      role: u.role,
      status: "active",
      last_seen_at: null,
      mfa_required: false,
      mfa_enrolled_at: null,
      created_at: now(),
      updated_at: now(),
    });
  }

  const ownerUid = userIdByEmail.get(seed.users.find((u) => u.role === "tenant_owner")!.email)!;

  // ── 2. Tenant doc ───────────────────────────────────────────────────────
  const trialEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const tenantDoc: TenantDoc & { demo_credentials: SeedUser[] } = {
    name: DEMO_TENANT_NAME,
    slug: DEMO_TENANT_SLUG,
    type: "med_spa",
    owner_user_id: ownerUid,
    owner_email: seed.users.find((u) => u.role === "tenant_owner")!.email,
    subscription_tier: "enterprise",
    subscription_status: "active",
    trial_ends_at: Timestamp.fromDate(trialEnd),
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_connect_account_id: null,
    stripe_connect_charges_enabled: false,
    stripe_connect_payouts_enabled: false,
    stripe_connect_details_submitted: false,
    primary_color: null,
    logo_url: null,
    timezone: "America/Denver",
    hipaa_baa_signed_at: Timestamp.now(),
    twilio_phone_number: null,
    twilio_subaccount_sid: null,
    twilio_subaccount_auth_token_enc: null,
    google_review_url: null,
    onboarded_at: Timestamp.now(),
    menu_overrides: null,
    menu_lock_owner_only: false,
    // Persist credentials so re-seed reveals same passwords
    demo_credentials: seed.users,
    created_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  };
  await db().collection("tenants").doc(DEMO_TENANT_SLUG).set(tenantDoc);

  // ── 3. Locations ─────────────────────────────────────────────────────────
  for (const loc of seed.locations) {
    await tenantCol(DEMO_TENANT_SLUG, "locations").doc(loc.id).set({
      tenant_id: DEMO_TENANT_SLUG,
      name: loc.name,
      address_line_1: `${100 + Math.floor(Math.random() * 900)} Main St`,
      address_line_2: null,
      city: loc.city,
      state: loc.state,
      postal_code: loc.postal,
      country: "US",
      phone: loc.phone,
      timezone: "America/Denver",
      is_primary: loc.primary,
      is_active: true,
      created_at: now(),
      updated_at: now(),
    });
  }

  // ── 4. Services ──────────────────────────────────────────────────────────
  for (const svc of seed.services) {
    await tenantCol(DEMO_TENANT_SLUG, "services").doc(svc.id).set({
      tenant_id: DEMO_TENANT_SLUG,
      name: svc.name,
      category: svc.category,
      duration_minutes: svc.durationMin,
      price_cents: svc.priceCents,
      description: null,
      is_active: true,
      consumes: null,
      deposit_cents: svc.priceCents > 30000 ? 5000 : null,
      recommended_rebook_days: svc.rebookDays,
      created_at: now(),
      updated_at: now(),
    });
  }

  // ── 5. Products ──────────────────────────────────────────────────────────
  for (const p of seed.products) {
    await tenantCol(DEMO_TENANT_SLUG, "products").doc(p.id).set({
      tenant_id: DEMO_TENANT_SLUG,
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      on_hand_quantity: p.onHand,
      reorder_threshold: p.reorderAt,
      cost_cents_per_unit: p.costCents,
      supplier: p.supplier,
      notes: null,
      is_active: true,
      archived_at: null,
      last_low_stock_alert_at: null,
      created_at: now(),
      updated_at: now(),
    });
  }

  // ── 6. Provider docs (one per provider user; doc id = uid) ──────────────
  for (const u of seed.users.filter((x) => x.role === "tenant_provider")) {
    const uid = userIdByEmail.get(u.email)!;
    await tenantCol(DEMO_TENANT_SLUG, "providers").doc(uid).set({
      tenant_id: DEMO_TENANT_SLUG,
      user_id: uid,
      email: u.email,
      full_name: u.fullName,
      title: u.email.includes("walsh") ? "NP, RN" : "MD",
      phone: null,
      is_active: true,
      scheduling_color: u.email.includes("walsh") ? "#07667a" : "#b98f42",
      default_location_id: seed.locations[0].id,
      ics_token: null,
      created_at: now(),
      updated_at: now(),
    });
  }

  // ── 7. Clients ───────────────────────────────────────────────────────────
  for (const c of seed.clients) {
    const created = Date.now() - c.createdDaysAgo * 24 * 60 * 60 * 1000;
    await tenantCol(DEMO_TENANT_SLUG, "clients").doc(c.id).set({
      tenant_id: DEMO_TENANT_SLUG,
      email: c.email,
      full_name: c.fullName,
      phone: c.phone,
      date_of_birth: null,
      preferred_name: null,
      default_location_id: c.defaultLocationId,
      email_consent: c.emailConsent,
      sms_consent: c.smsConsent,
      hipaa_consent_signed_at: Math.random() > 0.2 ? Timestamp.fromMillis(created + 60 * 1000) : null,
      tags: c.tags,
      created_at: Timestamp.fromMillis(created),
      updated_at: Timestamp.fromMillis(created),
    });
  }

  // ── 8. Appointments + (some) charts ──────────────────────────────────────
  for (const a of seed.appointments) {
    const startsAt = Timestamp.fromMillis(a.startsAtMs);
    const endsAt = Timestamp.fromMillis(a.startsAtMs + a.durationMin * 60 * 1000);
    const providerUid = userIdByEmail.get(a.providerEmail)!;
    const chartId = a.hasChart ? a.id : null; // chart docs use appointment id
    await tenantCol(DEMO_TENANT_SLUG, "appointments").doc(a.id).set({
      tenant_id: DEMO_TENANT_SLUG,
      client_id: a.clientId,
      provider_id: providerUid,
      location_id: a.locationId,
      service: a.service,
      starts_at: startsAt,
      ends_at: endsAt,
      status: a.status as AppointmentStatus,
      notes: null,
      chart_id: chartId,
      confirmation_sms_at: a.startsAtMs < Date.now() ? startsAt : null,
      reminder_sms_at: a.startsAtMs < Date.now() ? startsAt : null,
      cancelled_at: a.status === "cancelled" ? startsAt : null,
      cancellation_reason: a.status === "cancelled" ? "Schedule conflict" : null,
      cancelled_by_user_id: null,
      rescheduled_from_at: null,
      reschedule_count: 0,
      manage_token: null,
      deposit_payment_intent_id: null,
      deposit_payment_id: null,
      deposit_status: "none",
      review_request_sent_at: a.status === "completed" && Math.random() > 0.4 ? startsAt : null,
      rebook_prompt_sent_at: null,
      recurrence_rule: null,
      parent_appointment_id: null,
      created_at: startsAt,
      updated_at: startsAt,
      // Carry the price for revenue calc (used by /api/owner/reports)
      price_cents: a.priceCents,
    } as Record<string, unknown>);

    if (a.hasChart) {
      const provider = seed.users.find((u) => u.email === a.providerEmail)!;
      await tenantCol(DEMO_TENANT_SLUG, "charts").doc(a.id).set({
        tenant_id: DEMO_TENANT_SLUG,
        appointment_id: a.id,
        client_id: a.clientId,
        provider_id: providerUid,
        subjective: `Returning patient for ${a.service}. Goals discussed and reviewed.`,
        objective: "Vital signs WNL per provider observation.",
        assessment: "Good candidate; treatment plan reviewed and agreed.",
        plan: "Proceed with treatment as discussed. Routine post-care instructions provided.",
        status: a.chartSigned ? "signed" : "draft",
        signed_at: a.chartSigned ? startsAt : null,
        signed_by_user_id: a.chartSigned ? providerUid : null,
        signed_by_full_name: a.chartSigned ? provider.fullName : null,
        amends_chart_id: null,
        created_at: startsAt,
        updated_at: startsAt,
      });
    }
  }

  // ── 9. Leads (platform-level — ROOT collection, not tenant-scoped) ──────
  for (const l of seed.leads) {
    const created = Date.now() - l.createdDaysAgo * 24 * 60 * 60 * 1000;
    await db().collection("leads").doc(l.id).set({
      contact_id: null,
      contact: { email: l.email, full_name: l.fullName, phone: l.phone, role: "owner" },
      company_id: null,
      company: { name: l.company, type: "med_spa", locations_count: "2-3" },
      source: l.source,
      interest: "demo",
      status: l.status,
      raw_payload: { demo: true, tenant_slug: DEMO_TENANT_SLUG },
      utm_source: l.utm_source,
      utm_medium: l.utm_medium,
      utm_campaign: l.utm_campaign,
      notes: null,
      ip: null,
      user_agent: null,
      created_at: Timestamp.fromMillis(created),
      updated_at: Timestamp.fromMillis(created),
    });
  }

  // ── 10. Campaign runs ─────────────────────────────────────────────────────
  for (const r of seed.campaignRuns) {
    const sent = Date.now() - r.sentDaysAgo * 24 * 60 * 60 * 1000;
    await tenantCol(DEMO_TENANT_SLUG, "campaign_runs").doc(r.id).set({
      tenant_id: DEMO_TENANT_SLUG,
      campaign_id: r.campaignId,
      trigger: r.trigger,
      channel: r.channel,
      client_id: r.clientId,
      client_email: r.clientEmail,
      subject: r.channel === "email" ? `${labelForTrigger(r.trigger)} from your provider` : null,
      body_html: null,
      body_text: r.channel === "sms" ? `Hi! ${labelForTrigger(r.trigger)} — let us know if you'd like to book.` : null,
      status: r.status,
      failure_reason: r.status === "bounced" ? "mailbox_full" : null,
      sent_by_user_id: ownerUid,
      sent_by_email: tenantDoc.owner_email,
      step_index: 0,
      queued_at: Timestamp.fromMillis(sent - 60 * 1000),
      sent_at:
        r.status === "queued" || r.status === "skipped_consent" || r.status === "skipped_cooldown"
          ? null
          : Timestamp.fromMillis(sent),
      delivered_at:
        ["delivered", "opened", "clicked"].includes(r.status)
          ? Timestamp.fromMillis(sent + 30 * 1000)
          : null,
      opened_at:
        ["opened", "clicked"].includes(r.status) ? Timestamp.fromMillis(sent + 600 * 1000) : null,
      created_at: Timestamp.fromMillis(sent - 60 * 1000),
    });
  }

  // ── 11. Audit trail ──────────────────────────────────────────────────────
  void writeAudit({
    action: "admin.user_create",
    actorEmail: session.email,
    actorUserId: session.firebaseUid,
    targetType: "tenant.demo_seed",
    targetId: DEMO_TENANT_SLUG,
    after: {
      tenant_slug: DEMO_TENANT_SLUG,
      users: seed.users.length,
      locations: seed.locations.length,
      services: seed.services.length,
      clients: seed.clients.length,
      appointments: seed.appointments.length,
      leads: seed.leads.length,
      campaign_runs: seed.campaignRuns.length,
      products: seed.products.length,
    },
  }).catch((err) => console.error("[demo-seed] audit", err));

  return NextResponse.json({
    ok: true,
    slug: DEMO_TENANT_SLUG,
    name: DEMO_TENANT_NAME,
    counts: {
      users: seed.users.length,
      locations: seed.locations.length,
      services: seed.services.length,
      clients: seed.clients.length,
      appointments: seed.appointments.length,
      leads: seed.leads.length,
      campaign_runs: seed.campaignRuns.length,
      products: seed.products.length,
    },
    credentials: seed.users,
  });
}

function labelForTrigger(t: string): string {
  switch (t) {
    case "birthday_week":           return "Happy birthday week";
    case "post_treatment_21_day":   return "21-day check-in";
    case "reactivation_90_day":     return "Welcome back";
    case "welcome_new_client":      return "Welcome to the clinic";
    case "upsell_post_visit":       return "Quick follow-up suggestion";
    default:                        return "Update";
  }
}
