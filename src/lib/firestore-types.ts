/**
 * Firestore collection schemas for the Aesthera super-admin CRM.
 *
 * Naming: doc IDs are noted per collection.
 * Timestamps: stored as Firestore Timestamps; helpers in firestore.ts convert
 * to JS Date on read.
 *
 * Denormalization strategy: read-optimized. A lead doc stores a snapshot of
 * the contact and company at capture time so list queries don't need joins.
 * Updating a contact does NOT backfill prior leads — leads are intentionally
 * a moment-in-time record.
 */

import type { Timestamp } from "firebase-admin/firestore";

// ─── auth ─────────────────────────────────────────────────────────────────────

export type UserRole =
  | "super_admin"
  // Clinic-facing roles, scoped to a tenant via tenant_id claim. Order
  // implies privilege: owner > manager > provider > front_desk > client.
  // Each role has its own portal route (/owner, /manager, /provider,
  // /front-desk, /client) and an AI assistant scoped to the data + tools
  // that role is authorized for.
  | "tenant_owner"
  | "tenant_manager"
  | "tenant_provider"
  | "tenant_front_desk"
  | "tenant_client";

export type UserStatus = "active" | "suspended" | "deleted";

// ─── tenants (Phase 2) ───────────────────────────────────────────────────────

export type TenantSubscriptionTier = "founding_25" | "basic" | "growth" | "enterprise";
export type TenantStatus = "active" | "trialing" | "paused" | "cancelled";

/**
 * Collection: `tenants`. Doc ID = slug (kebab-case derived from name).
 * Each tenant is one clinic (or clinic group for multi-location operators).
 *
 * Per-tenant data lives in subcollections:
 *   tenants/{tenantId}/locations/{locationId}
 *   tenants/{tenantId}/providers/{providerId}
 *   tenants/{tenantId}/clients/{clientId}      (clients = patients of the clinic)
 *   tenants/{tenantId}/appointments/{appointmentId}
 *   tenants/{tenantId}/charts/{chartId}        (Phase 3)
 *   tenants/{tenantId}/photos/{photoId}        (Phase 3 — meta only; binary in Cloud Storage)
 *
 * Security: rules use request.auth.token.tenant_id to scope access.
 */
export type TenantDoc = {
  name: string;
  slug: string; // matches doc ID; kept for queries
  type: CompanyType; // med_spa, aesthetic_clinic, etc.
  owner_user_id: string; // Firebase UID of the clinic owner
  owner_email: string;
  subscription_tier: TenantSubscriptionTier;
  subscription_status: TenantStatus;
  trial_ends_at: Timestamp | null;
  // Stripe (Phase 5)
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  // Stripe Connect (Phase 6.1) — clinic charges its own clients via the
  // platform. Account is Express; charges_enabled flips true after the
  // owner finishes onboarding (KYC + bank).
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
  stripe_connect_details_submitted: boolean;
  // Branding (clinic-specific override of platform defaults)
  primary_color: string | null;
  logo_url: string | null;
  // Operational
  timezone: string; // IANA, e.g. "America/Denver"
  hipaa_baa_signed_at: Timestamp | null;
  // Two-way SMS (Phase 6.4) — the Twilio number this clinic uses for
  // confirmations, reminders, and inbound conversations. Null until
  // configured in Settings or auto-provisioned.
  twilio_phone_number: string | null;
  // Twilio subaccount auto-provisioning (Option C). When set, all SMS
  // for this tenant is sent through the subaccount's auth_token, so
  // billing + A2P brand registration are isolated per tenant. Null =
  // tenant uses platform-level Twilio creds (legacy / Option B).
  // The auth_token is encrypted via OAUTH_TOKEN_KEY before persistence.
  twilio_subaccount_sid: string | null;
  twilio_subaccount_auth_token_enc: string | null;
  // Google Reviews (Phase 6.9) — the clinic's GMB review URL. The
  // post-visit review-request cron emails this link. Null disables.
  google_review_url: string | null;
  /** Set when the post-checkout onboarding wizard completes; null = redirect to wizard. */
  onboarded_at: Timestamp | null;
  /**
   * Per-tenant menu overrides — lets a clinic customize which role sees
   * which sidebar item without us shipping a code change. Keys are the
   * route path ("/manager/inventory"), values list the roles that should
   * see that item. Absent key = default visibility from NAV_BY_ROLE.
   *
   * Example: a clinic decides Inventory should be a Front Desk
   * responsibility →
   *   { "/manager/inventory": ["tenant_owner"],
   *     "/front-desk/inventory": ["tenant_owner","tenant_manager","tenant_front_desk"] }
   */
  menu_overrides: Record<string, UserRole[]> | null;
  /**
   * When true, only owners can edit menu_overrides. When false (default),
   * managers can also edit. Toggle on the Owner team page.
   */
  menu_lock_owner_only: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** Collection: `tenants/{tenantId}/locations`. Doc ID = auto. */
export type LocationDoc = {
  tenant_id: string;
  name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  phone: string | null;
  timezone: string;
  is_primary: boolean;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Collection: `tenants/{tenantId}/services`. Doc ID = auto.
 * Service catalog — what the clinic offers and at what duration/price.
 */
export type ServiceCategory =
  | "injectables"
  | "facial"
  | "laser"
  | "body"
  | "iv_therapy"
  | "wellness"
  | "consultation"
  | "other";

export type ServiceConsumes = {
  product_id: string;
  qty: number;
};

export type ServiceDoc = {
  tenant_id: string;
  name: string;
  category: ServiceCategory;
  duration_minutes: number;
  price_cents: number | null;
  description: string | null;
  is_active: boolean;
  // Inventory: products consumed per delivery of this service. Deducted
  // from `tenants/{slug}/products/{product_id}.on_hand_quantity` when a
  // chart for this service is signed.
  consumes: ServiceConsumes[] | null;
  // Deposit (Phase 6.2). When set, embed booking + owner manual booking
  // require a held PaymentIntent for this amount. Captured when the
  // appointment is marked completed; refunded on cancel.
  deposit_cents: number | null;
  // Suggested rebook interval (Phase 6.7). 90 = "rebook in 90 days."
  // null = no auto-prompt for rebooking on this service.
  recommended_rebook_days: number | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** Collection: `tenants/{tenantId}/providers`. Doc ID = Firebase UID. */
export type ProviderDoc = {
  tenant_id: string;
  user_id: string; // matches doc ID
  email: string;
  full_name: string;
  title: string | null; // RN, NP, MD, Aesthetician, etc.
  phone: string | null;
  is_active: boolean;
  scheduling_color: string | null;
  default_location_id: string | null;
  // Calendar export (Phase 6.9) — random unguessable token. Owner gives
  // the provider the URL /api/calendar/{ics_token}.ics to subscribe in
  // Google/Apple Calendar.
  ics_token: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Collection: `tenants/{tenantId}/clients`. Doc ID = auto.
 * "Clients" here means the clinic's patients/customers — distinct from
 * crm.contacts which are leads of the platform itself.
 */
export type ClientDoc = {
  tenant_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  date_of_birth: string | null; // ISO date
  preferred_name: string | null;
  default_location_id: string | null;
  // Marketing consent (per-channel)
  email_consent: boolean;
  sms_consent: boolean;
  // HIPAA / consent
  hipaa_consent_signed_at: Timestamp | null;
  // Tags
  tags: string[];
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Collection: `tenants/{tenantId}/appointments`. Doc ID = auto.
 * Phase 2 minimum schema — booking, scheduling, status.
 */
export type AppointmentStatus =
  | "scheduled"
  | "checked_in"
  | "in_progress"
  | "completed"
  | "no_show"
  | "cancelled";

/**
 * Collection: `tenants/{tenantId}/charts`. Doc ID = appointment ID (1:1).
 *
 * SOAP note. Once status='signed', UPDATEs are denied at the application
 * AND security-rule layer. Amendments require a new chart entry pointing
 * back via amends_chart_id (Phase 3+).
 */
export type ChartStatus = "draft" | "signed";

export type ChartDoc = {
  tenant_id: string;
  appointment_id: string;
  client_id: string;
  provider_id: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  status: ChartStatus;
  signed_at: Timestamp | null;
  signed_by_user_id: string | null;
  signed_by_full_name: string | null;
  amends_chart_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type AppointmentDoc = {
  tenant_id: string;
  client_id: string;
  provider_id: string;
  location_id: string;
  service: string; // free-form for now; service catalog comes later
  starts_at: Timestamp;
  ends_at: Timestamp;
  status: AppointmentStatus;
  notes: string | null;
  // Photos / charts attached (IDs only)
  chart_id: string | null;
  // SMS lifecycle (Phase 5.3 — null on legacy rows, populated on new bookings)
  confirmation_sms_at: Timestamp | null;
  reminder_sms_at: Timestamp | null;
  // Cancellation / reschedule tracking (Phase 5.13)
  cancelled_at: Timestamp | null;
  cancellation_reason: string | null;
  cancelled_by_user_id: string | null;
  rescheduled_from_at: Timestamp | null;
  reschedule_count: number;
  /** Random unguessable token so the booking client can manage it from email. */
  manage_token: string | null;
  // Deposit (Phase 6.2)
  deposit_payment_intent_id: string | null;
  deposit_payment_id: string | null; // PaymentDoc.id in tenants/{slug}/payments
  deposit_status: "none" | "held" | "captured" | "refunded" | "failed";
  // Review automation (Phase 6.9) — set after we send the post-visit ask
  review_request_sent_at: Timestamp | null;
  // Auto-rebook (Phase 6.7) — set after we send the "time to rebook" email
  rebook_prompt_sent_at: Timestamp | null;
  // Recurrence (Phase 6.7) — for member auto-scheduled visits
  recurrence_rule: string | null; // e.g. "FREQ=MONTHLY;INTERVAL=1"
  parent_appointment_id: string | null; // chains a series
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** Collection: `users`. Doc ID = Firebase UID. */
export type UserDoc = {
  email: string; // lowercase
  display_name: string | null;
  role: UserRole;
  status: UserStatus;
  last_seen_at: Timestamp | null;
  mfa_required: boolean;
  mfa_enrolled_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** Collection: `login_attempts`. Doc ID = auto. */
export type LoginAttemptDoc = {
  email: string | null;
  firebase_uid: string | null;
  succeeded: boolean;
  failure_reason: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: Timestamp;
};

// ─── crm ──────────────────────────────────────────────────────────────────────

export type CompanyType =
  | "med_spa"
  | "aesthetic_clinic"
  | "iv_lounge"
  | "wellness_studio"
  | "lash_brow_studio"
  | "head_spa"
  | "other"
  | "unknown";

export type LocationsBucket = "1" | "2-3" | "4-9" | "10+" | "unknown";

export type ContactRole =
  | "owner"
  | "medical_director"
  | "manager"
  | "provider"
  | "other";

export type LeadSource =
  | "marketing_site"
  | "referral"
  | "cold"
  | "partner"
  | "event"
  | "other";

export type LeadInterest = "demo" | "early_access" | "pricing" | "other";

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "demo_booked"
  | "demo_done"
  | "founding_spot_held"
  | "closed_won"
  | "closed_lost"
  | "no_response";

export type DealStatus = "open" | "won" | "lost" | "paused";

export type ActivityType =
  | "email_sent"
  | "email_received"
  | "call"
  | "sms"
  | "meeting"
  | "note"
  | "status_change"
  | "task_completed"
  | "system";

export type TaskStatus = "open" | "completed" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

/** Collection: `companies`. Doc ID = auto. */
export type CompanyDoc = {
  name: string;
  name_lower: string; // for case-insensitive lookups (Firestore has no LOWER())
  type: CompanyType;
  website: string | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string;
  locations_count: LocationsBucket | null;
  source: string;
  notes: string | null;
  // denormalized counts — updated by callers when relations change
  contact_count: number;
  lead_count: number;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Collection: `contacts`. Doc ID = lowercased email.
 * Using email as the doc ID gives us a free unique constraint and O(1) upserts.
 */
export type ContactDoc = {
  email: string; // lowercase, matches doc ID
  full_name: string | null;
  phone: string | null;
  role: ContactRole | null;
  company_id: string | null;
  company_name: string | null; // denormalized
  do_not_contact: boolean;
  email_unsubscribed: boolean;
  sms_unsubscribed: boolean;
  source: string;
  tags: string[]; // tag names, denormalized
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** Collection: `tags`. Doc ID = name (lowercased, kebab-case). */
export type TagDoc = {
  name: string;
  color: string | null;
  description: string | null;
  created_at: Timestamp;
};

/** Collection: `pipeline_stages`. Doc ID = slug (e.g. "new", "demo-booked"). */
export type PipelineStageDoc = {
  name: string;
  order_index: number;
  is_won: boolean;
  is_lost: boolean;
  color: string | null;
  created_at: Timestamp;
};

/** Collection: `leads`. Doc ID = auto. Snapshots contact + company at capture. */
export type LeadDoc = {
  contact_id: string | null; // contact doc ID (email)
  contact: {
    email: string;
    full_name: string | null;
    phone: string | null;
    role: ContactRole | null;
  };
  company_id: string | null;
  company: {
    name: string;
    type: CompanyType;
    locations_count: LocationsBucket | null;
  };
  source: LeadSource;
  interest: LeadInterest;
  status: LeadStatus;
  raw_payload: Record<string, unknown> | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  notes: string | null;
  ip: string | null;
  user_agent: string | null;
  // ── Dedup qualifiers (Phase 7) ───────────────────────────────────────────
  // Top-level fields (not nested) so Firestore single-field equality
  // indexing applies. Computed server-side via src/lib/lead-dedup.ts on
  // every ingest. The /match endpoint and POST merge logic both look up
  // by these in priority order.
  email_normalized: string | null;
  phone_digits: string | null;
  linkedin_normalized: string | null;
  name_company_key: string | null;
  apollo_person_id: string | null;
  external_id: string | null;
  // ── Soft delete (Phase 7) ────────────────────────────────────────────────
  // GET /api/integrations/jarvis/leads excludes deleted_at!=null by default.
  deleted_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** Collection: `deals`. Doc ID = auto. */
export type DealDoc = {
  company_id: string;
  company_name: string; // denormalized
  primary_contact_id: string | null;
  pipeline_stage: string; // stage doc ID slug
  name: string;
  monthly_value_cents: number | null;
  is_founding_25: boolean;
  founding_spot_number: number | null; // 1..25, unique enforced by app + check
  status: DealStatus;
  expected_close_date: Timestamp | null;
  closed_at: Timestamp | null;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** Collection: `activities`. Doc ID = auto. */
export type ActivityDoc = {
  contact_id: string | null;
  company_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  type: ActivityType;
  summary: string;
  details: Record<string, unknown> | null;
  created_by: string | null; // user doc ID (firebase UID)
  occurred_at: Timestamp;
  created_at: Timestamp;
};

/** Collection: `notes`. Doc ID = auto. */
export type NoteDoc = {
  contact_id: string | null;
  company_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  body: string;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/** Collection: `tasks`. Doc ID = auto. */
export type TaskDoc = {
  contact_id: string | null;
  company_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: Timestamp | null;
  completed_at: Timestamp | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

// ─── marketing (Phase 4.2) ───────────────────────────────────────────────────

export type CampaignTriggerType =
  | "birthday_week"
  | "post_treatment_21_day"
  | "reactivation_90_day"
  | "welcome_new_client"
  | "upsell_post_visit";

export type CampaignChannel = "email" | "sms";
export type CampaignStatus = "draft" | "active" | "paused" | "archived";

/**
 * Optional step-level override for multi-step drip sequences. A campaign
 * with steps=[] (or absent) is single-shot at trigger time. A campaign
 * with steps=[s1, s2, s3] sends the base trigger as step 0, then s1
 * delay_days later as step 1, etc.
 */
export type CampaignStep = {
  /** Days after the previous step (or trigger entry for step 1). */
  delay_days: number;
  /** Optional addendum to the parent campaign brief. Helps the AI target this step. */
  brief_addendum: string | null;
  /** Optional CTA override. */
  call_to_action: string | null;
};

export type CampaignDoc = {
  tenant_id: string;
  trigger: CampaignTriggerType;
  channel: CampaignChannel;
  name: string;
  brief: string;
  call_to_action: string | null;
  status: CampaignStatus;
  cooldown_days: number;
  /** Optional drip steps. Empty / absent = single-shot. */
  steps?: CampaignStep[];
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type CampaignRunStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "failed"
  | "skipped_cooldown"
  | "skipped_consent";

export type CampaignRunDoc = {
  tenant_id: string;
  campaign_id: string;
  trigger: CampaignTriggerType;
  channel: CampaignChannel;
  client_id: string;
  client_email: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  status: CampaignRunStatus;
  failure_reason: string | null;
  sent_by_user_id: string | null;
  sent_by_email: string | null;
  /** Drip step index. 0 = trigger entry / single-shot. Optional for legacy rows. */
  step_index?: number | null;
  queued_at: Timestamp | null;
  sent_at: Timestamp | null;
  delivered_at: Timestamp | null;
  opened_at: Timestamp | null;
  created_at: Timestamp;
};

// ─── Digital consent forms (Phase 5.11) ───────────────────────────────────────

export type ConsentTemplateStatus = "draft" | "active" | "archived";

/**
 * Collection: `tenants/{tenantId}/consent_templates/{id}`. Doc ID = auto.
 *
 * The clinic-authored boilerplate (Botox consent, IV therapy consent,
 * filler consent, etc). Plain-text body for now (rendered into PDF at
 * sign time). Versioned: creating a new active template archives prior
 * versions but doesn't break existing signed consents (they reference
 * a frozen body_snapshot).
 */
/**
 * Phase 6.10: a template can be either a legal consent OR an intake
 * form (pre-visit health questionnaire). Same signing infrastructure;
 * just a UI discriminator + a slightly different signing-page header.
 */
export type ConsentTemplateKind = "consent" | "intake";

export type ConsentTemplateDoc = {
  tenant_id: string;
  name: string;
  description: string | null;
  /** "consent" (legal) or "intake" (pre-visit questionnaire). */
  kind: ConsentTemplateKind;
  /** Plain text — paragraphs separated by \n\n. Newlines preserved in PDF. */
  body: string;
  /** Bumped on each save. UI can show edit history. */
  version: number;
  status: ConsentTemplateStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ConsentStatus = "pending" | "signed" | "expired" | "revoked";

/**
 * Collection: `tenants/{tenantId}/consents/{id}`. Doc ID = auto.
 *
 * One row per (template, client, signing event). When pending it
 * exposes a public signing URL via `signing_token`. Once signed it
 * stores a frozen snapshot of the template body + the captured
 * signature + the rendered PDF path in Cloud Storage.
 *
 * Signed consents are immutable. Deletion goes through revoke
 * (status=revoked) + audit, never destructive delete.
 */
export type ConsentDoc = {
  tenant_id: string;
  template_id: string;
  template_name_snapshot: string;
  client_id: string | null;
  client_email_snapshot: string;
  client_name_snapshot: string;
  appointment_id: string | null;
  /** Random unguessable token for the public /consent/[token] URL. */
  signing_token: string;
  status: ConsentStatus;
  /** Frozen body the signer agreed to (decoupled from template edits). */
  body_snapshot: string;
  /** PNG data URL of the captured pen signature, base64-decoded into Cloud Storage. */
  signature_storage_path: string | null;
  /** Final rendered PDF path in Cloud Storage. */
  pdf_storage_path: string | null;
  pdf_byte_size: number | null;
  /** Audit metadata — captured at sign time. */
  signed_at: Timestamp | null;
  signer_typed_name: string | null;
  signer_ip: string | null;
  signer_user_agent: string | null;
  /** When the signing link expires if unsigned. */
  expires_at: Timestamp;
  /** Who initiated the signing request. */
  initiated_by_user_id: string | null;
  initiated_by_email: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

// ─── Clinical photos (Phase 5.10) ─────────────────────────────────────────────

export type PhotoKind = "before" | "after" | "during" | "other";

/**
 * Collection: `tenants/{tenantId}/photos/{photoId}`. Doc ID = auto.
 *
 * Photo metadata (binary lives in Cloud Storage at storage_path).
 * Tightly scoped to (tenant, client) and optionally (appointment, chart).
 *
 * Pairing: a "before" photo points to its matching "after" via pair_id
 * (and vice-versa). Comparison view in the UI uses this.
 *
 * Once a chart is signed, photos linked via chart_id should not be
 * deletable through the standard API (PHI integrity). Deletion of
 * unsigned-chart-linked or unattached photos is allowed.
 */
export type PhotoDoc = {
  tenant_id: string;
  client_id: string;
  appointment_id: string | null;
  chart_id: string | null;
  /** GCS path: tenants/{slug}/clients/{clientId}/{photoId}.{ext} */
  storage_path: string;
  /** Optional thumbnail path (server-generated, future). */
  thumbnail_path: string | null;
  content_type: string; // image/jpeg | image/png | image/webp
  byte_size: number;
  width: number | null;
  height: number | null;
  kind: PhotoKind;
  label: string | null;
  notes: string | null;
  /** Date the photo was taken (provider-set or client-uploaded; falls back to upload time). */
  taken_at: Timestamp | null;
  /** ID of the matched photo in a before/after pair. */
  pair_id: string | null;
  uploaded_by_user_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

// ─── Tier usage counters (Phase 5.9) ──────────────────────────────────────────

/**
 * Per-tenant monthly usage counters. Doc id = "YYYY-MM" (UTC). New
 * month = new doc, no migration. Read at quota-check time, incremented
 * atomically with FieldValue.increment(1) when an AI/marketing/SMS
 * operation succeeds.
 *
 * Collection: `tenants/{tenantId}/usage/{yyyy_mm}`.
 */
export type UsageDoc = {
  tenant_id: string;
  period: string; // "2026-05"
  ai_soap_drafts: number;
  ai_marketing_emails: number;
  ai_concierge_turns: number;
  sms_sent: number;
  updated_at: Timestamp;
};

// ─── CRM workflows (Phase 5.7) ────────────────────────────────────────────────

/**
 * A nurture/automation workflow that enrolls platform-CRM contacts. Pure
 * Firestore implementation — modeled after the salisburybookkeeping.com
 * /admin/workflows surface but structurally independent (no shared data,
 * no shared infra, GCP-only). Triggers + steps describe behavior in a
 * runnable, future-proof way; for the MVP we only need tag-based
 * enrollment + activity logging. Email send happens externally (Resend
 * via salisburybookkeeping.com workflow runner in the short term, then
 * native here once the Aesthera mailer domain ships).
 */
export type WorkflowTriggerType =
  | "tag_added"
  | "tag_removed"
  | "lead_created"
  | "deal_stage_changed"
  | "manual";

export type WorkflowStatus = "draft" | "active" | "paused" | "archived";

export type WorkflowStepActionType =
  | "apply_tag"
  | "remove_tag"
  | "wait"
  | "send_email"
  | "set_lead_status"
  | "create_task"
  | "webhook"
  | "enroll_in_workflow";

export type WorkflowStep = {
  /** Stable id used by enrollments to track progress. */
  id: string;
  action: WorkflowStepActionType;
  /** Action-specific config (tag name, wait_days, email_template_id, etc). */
  config: Record<string, unknown>;
};

/** Collection: `workflows`. Doc ID = auto. */
export type WorkflowDoc = {
  name: string;
  description: string | null;
  /** The brand tag that, when applied to a contact, enrolls them. */
  trigger_type: WorkflowTriggerType;
  trigger_config: Record<string, unknown>;
  /** Sequenced steps. Empty = no-op (useful for tag-only routing). */
  steps: WorkflowStep[];
  status: WorkflowStatus;
  /** Don't re-enroll a contact within this many days. */
  cooldown_days: number;
  /** Counters maintained transactionally. */
  active_enrollments: number;
  total_enrollments: number;
  created_by_user_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type WorkflowEnrollmentStatus = "active" | "completed" | "exited" | "errored";

/**
 * Collection: `workflow_enrollments`. Doc ID = auto.
 * One row per (workflow, contact) pairing per enrollment cycle.
 */
export type WorkflowEnrollmentDoc = {
  workflow_id: string;
  workflow_name: string; // snapshot
  contact_id: string;
  contact_email: string;
  current_step_index: number;
  status: WorkflowEnrollmentStatus;
  enrolled_at: Timestamp;
  /** When the next step should fire (driven by wait actions). */
  next_run_at: Timestamp | null;
  last_step_at: Timestamp | null;
  completed_at: Timestamp | null;
  last_error: string | null;
  /** Where the enrollment came from: lead_id, deal_id, or manual. */
  source_type: "lead" | "deal" | "manual";
  source_id: string | null;
  enrolled_by_user_id: string | null;
};

// ─── social channel integrations (Phase 5.6) ─────────────────────────────────

/**
 * The social/ad platforms a tenant can connect via OAuth so the marketing
 * engine can publish to them. One platform = one row in
 * tenants/{tenantId}/social_connections.
 *
 * - meta covers Facebook + Instagram (same OAuth, different page selection)
 * - google covers Google Ads + YouTube (same OAuth, different scope sets)
 */
export type SocialPlatform =
  | "meta"
  | "x"
  | "google_ads"
  | "youtube"
  | "tiktok";

export type SocialConnectionStatus =
  | "connected"
  | "expired"
  | "revoked"
  | "error";

/**
 * Collection: `tenants/{tenantId}/social_connections`. Doc ID = SocialPlatform.
 *
 * Tokens are stored encrypted at rest (Firestore Google-managed encryption).
 * Refresh tokens are long-lived. Access tokens get refreshed on the server
 * before each publish, so we don't bother caching the latest access_token
 * back into Firestore — keep only refresh + identity metadata.
 *
 * NEVER write the access_token or refresh_token into audit_log.
 */
export type SocialConnectionDoc = {
  tenant_id: string;
  platform: SocialPlatform;
  status: SocialConnectionStatus;
  /** Display info for the connected account (no PII beyond what Meta/X show in their UIs). */
  account_id: string;
  account_handle: string | null; // @handle for X, page ID for Meta, channel ID for YouTube
  account_display_name: string | null;
  /** Encrypted at the application layer in addition to Firestore at-rest encryption. */
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_token_expires_at: Timestamp | null;
  /** Granular scopes the user authorized. */
  scopes: string[];
  /** Last time we successfully refreshed or used the connection. */
  last_used_at: Timestamp | null;
  last_error: string | null;
  connected_by_user_id: string | null;
  connected_by_email: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

// ─── inventory ────────────────────────────────────────────────────────────────

/**
 * Collection: `tenants/{tenantId}/products`. Doc ID = auto.
 * Inventory item — each ProductDoc represents one SKU. on_hand_quantity is
 * the source of truth and can go negative (real-world signal that the
 * count is off, fix-via-adjustment).
 */
export type ProductUnit = "unit" | "ml" | "vial" | "ea" | "syringe";

export type ProductDoc = {
  tenant_id: string;
  name: string;
  sku: string | null;
  unit: ProductUnit;
  on_hand_quantity: number;
  reorder_threshold: number | null;
  cost_cents_per_unit: number | null;
  supplier: string | null;
  notes: string | null;
  is_active: boolean; // false = archived (kept for movement history)
  archived_at: Timestamp | null;
  // Set when the low-stock notifier emails the owner about this SKU.
  // Used to debounce alerts to once per 24h.
  last_low_stock_alert_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ProductMovementType =
  | "received"
  | "used"
  | "adjusted"
  | "expired"
  | "returned";

/**
 * Collection: `tenants/{tenantId}/products/{productId}/movements`. Doc ID = auto.
 * Append-only ledger of stock changes. Each movement records the delta and
 * the resulting balance, so reconstructing on_hand_quantity from history is
 * always possible.
 */
export type ProductMovementDoc = {
  tenant_id: string;
  product_id: string;
  type: ProductMovementType;
  delta: number; // +received/+returned, -used/-expired, ±adjusted
  balance_after: number;
  reason: string | null;
  ref_type: "chart" | "appointment" | null;
  ref_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  created_at: Timestamp;
};

// ─── provider availability (Phase 6.5) ────────────────────────────────────────

/**
 * Doc: `tenants/{tenantId}/providers/{providerId}/availability/weekly`.
 *
 * Weekly recurring schedule. `intervals` is an array of [startMinute,
 * endMinute] tuples per day-of-week, in the tenant's timezone. minutes
 * = 0..1440. Empty array means provider is off that day.
 *
 * Example: 9am-12pm, 1pm-5pm Mon = [{ day: 1, start: 540, end: 720 },
 * { day: 1, start: 780, end: 1020 }].
 */
export type AvailabilityInterval = {
  day: number; // 0=Sun..6=Sat
  start: number; // minutes from midnight, tenant tz
  end: number;
};

export type ProviderAvailabilityDoc = {
  tenant_id: string;
  provider_id: string;
  intervals: AvailabilityInterval[];
  /** Default-applied template slug — for now only "default-9-5". */
  template: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Collection: `tenants/{tenantId}/providers/{providerId}/time_off/{id}`.
 * Date-range blackouts (vacation, conference, sick day). Bookings cannot
 * be made during a time-off range.
 */
export type ProviderTimeOffDoc = {
  tenant_id: string;
  provider_id: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  reason: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

// ─── waitlist (Phase 6.10) ────────────────────────────────────────────────────

/**
 * Collection: `tenants/{tenantId}/waitlist`. Doc ID = auto.
 * Captures demand when a popular slot is full. Owner notifies clients
 * manually (or via a future cancellation-driven cron) when an opening
 * appears.
 */
export type WaitlistStatus = "active" | "notified" | "booked" | "cancelled";

export type WaitlistDoc = {
  tenant_id: string;
  client_id: string;
  service_name: string; // free-form to match AppointmentDoc.service
  location_id: string | null;
  provider_id: string | null;
  /** Free-form notes from the client about preferred days/times. */
  notes: string | null;
  /** Day-of-week preferences (0..6). Empty array = any day. */
  preferred_days: number[];
  status: WaitlistStatus;
  notified_at: Timestamp | null;
  booked_appointment_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

// ─── two-way SMS conversations (Phase 6.4) ────────────────────────────────────

/**
 * Collection: `tenants/{tenantId}/conversations`. Doc ID = auto.
 *
 * One conversation per (tenant × client) pair. Messages live as a
 * subcollection. Inbound messages from Twilio land here too — we
 * resolve the client by phone number.
 */
export type ConversationDoc = {
  tenant_id: string;
  client_id: string | null; // null when we couldn't match the inbound number
  client_phone: string; // E.164 normalized
  last_message_at: Timestamp;
  last_message_preview: string; // truncated to ~120 chars
  last_direction: "inbound" | "outbound";
  unread_count_for_owner: number;
  /** Owner closed the conversation — hidden from default inbox view. */
  archived_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type MessageDirection = "inbound" | "outbound";
export type MessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered"
  | "received";

/**
 * Collection: `tenants/{tenantId}/conversations/{cid}/messages`. Doc ID = auto.
 * Append-only audit-grade record of every SMS sent or received.
 */
export type MessageDoc = {
  tenant_id: string;
  conversation_id: string;
  client_id: string | null;
  direction: MessageDirection;
  body: string;
  from_number: string; // E.164
  to_number: string; // E.164
  /** Twilio's MessageSid. Indexed for delivery-status webhook reconciliation. */
  twilio_sid: string | null;
  status: MessageStatus;
  /** For outbound messages — UID of the staff member who sent it. */
  actor_user_id: string | null;
  actor_email: string | null;
  /** True if the inbound text was a STOP/START keyword. */
  is_keyword: boolean;
  created_at: Timestamp;
};

// ─── payments (Stripe Connect) ────────────────────────────────────────────────

/**
 * Collection: `tenants/{tenantId}/payments`. Doc ID = auto.
 *
 * Unified ledger for every Stripe charge against the clinic's Connect
 * account: visit charges, deposits, packages, gift cards, tips, and
 * membership renewals. One row per Stripe PaymentIntent.
 *
 * `kind` is the BUSINESS-level reason (visit, deposit, package, gift_card,
 * tip, membership). The `ref_type` + `ref_id` pair points at the
 * associated tenant doc (appointment, package_purchase, gift_card,
 * client_membership). Null `ref_id` is allowed for tip-only or unlinked
 * pay-at-counter charges.
 */
export type PaymentKind =
  | "visit"
  | "deposit"
  | "package"
  | "gift_card"
  | "membership"
  | "tip"
  | "other";

export type PaymentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture" // deposit held but not yet captured
  | "succeeded"
  | "canceled"
  | "refunded"
  | "partially_refunded"
  | "failed";

export type PaymentDoc = {
  tenant_id: string;
  client_id: string | null;
  kind: PaymentKind;
  /** Total charged in cents. Includes tip + tax — see breakdown fields below. */
  amount_cents: number;
  /** Tip portion (already inside amount_cents). */
  tip_cents: number;
  /** Tax portion (already inside amount_cents). */
  tax_cents: number;
  /** Application fee taken by Aesthera, in cents. */
  application_fee_cents: number;
  currency: string; // ISO code, lowercase (e.g. "usd")
  status: PaymentStatus;
  /** Stripe Payment Intent ID. Indexed for webhook reconciliation. */
  stripe_payment_intent_id: string;
  stripe_charge_id: string | null;
  stripe_customer_id: string | null;
  /** Last-4 of card used (display only). */
  card_brand: string | null;
  card_last4: string | null;
  /** Receipt URL hosted by Stripe. */
  receipt_url: string | null;
  /** Refunded total in cents. Equal to amount_cents on full refund. */
  refunded_cents: number;
  ref_type: "appointment" | "package_purchase" | "gift_card" | "client_membership" | null;
  ref_id: string | null;
  description: string | null;
  /** Created at Stripe — different from doc created_at for late-arriving webhooks. */
  charged_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
};

// ─── packages + series (Phase 6.6) ────────────────────────────────────────────

/**
 * Collection: `tenants/{tenantId}/package_plans`. Doc ID = auto.
 * Template the clinic offers — e.g. "6-pack of HydraFacial, $750."
 * When a client buys, we instantiate a ClientPackageDoc by snapshotting
 * the relevant fields.
 */
export type PackagePlanDoc = {
  tenant_id: string;
  name: string;
  description: string | null;
  /** The service this package applies to. Free-form name to match
   *  AppointmentDoc.service (which is also free-form snapshot). */
  service_name: string;
  sessions_total: number;
  price_cents: number;
  /** Days from purchase to expiration. null = never expires. */
  expires_in_days: number | null;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type ClientPackageSource = "paid" | "comp" | "gift";

/**
 * Collection: `tenants/{tenantId}/client_packages`. Doc ID = auto.
 * Instance owned by one client. Sessions_remaining decrements on
 * each redemption.
 */
export type ClientPackageDoc = {
  tenant_id: string;
  client_id: string;
  plan_id: string;
  plan_name_snapshot: string;
  service_name_snapshot: string;
  sessions_total: number;
  sessions_remaining: number;
  /** Total paid for the package — informational. */
  price_cents_snapshot: number;
  source: ClientPackageSource;
  expires_at: Timestamp | null;
  /** Pointer to the PaymentDoc if source=paid. */
  payment_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Collection: `.../client_packages/{id}/redemptions`. Append-only.
 * One row per session used.
 */
export type PackageRedemptionDoc = {
  tenant_id: string;
  client_package_id: string;
  client_id: string;
  appointment_id: string | null; // null for manual draws
  sessions_used: number;
  balance_after: number;
  reason: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  created_at: Timestamp;
};

// ─── gift cards (Phase 6.6) ───────────────────────────────────────────────────

/**
 * Collection: `tenants/{tenantId}/gift_cards`. Doc ID = unguessable code.
 *
 * Cards are tenant-scoped. Code is also stored as the doc ID for direct
 * lookup. balance_cents starts equal to original_amount_cents and
 * decrements on each redemption.
 */
export type GiftCardSource = "purchased" | "comp" | "manual";

export type GiftCardDoc = {
  tenant_id: string;
  code: string; // duplicated as doc ID
  original_amount_cents: number;
  balance_cents: number;
  recipient_email: string | null;
  recipient_name: string | null;
  sender_name: string | null;
  message: string | null;
  expires_at: Timestamp | null;
  source: GiftCardSource;
  /** Pointer to PaymentDoc when source=purchased. */
  payment_id: string | null;
  /** Set when fully redeemed. */
  fully_redeemed_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Append-only ledger of redemptions.
 * Collection: `.../gift_cards/{code}/redemptions`. Doc ID = auto.
 */
export type GiftCardRedemptionDoc = {
  tenant_id: string;
  gift_card_code: string;
  amount_cents: number; // positive number drawn down
  balance_after_cents: number;
  applied_to: "appointment" | "package" | "manual" | null;
  ref_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  created_at: Timestamp;
};

// ─── memberships ──────────────────────────────────────────────────────────────

/**
 * Collection: `tenants/{tenantId}/membership_plans`. Doc ID = auto.
 * Defines a recurring membership offering (e.g. "VIP Aesthetic — $149/mo").
 * Clients enroll via ClientMembershipDoc. Stripe billing is optional —
 * tenants can also manually track payments outside of Stripe.
 */
export type MembershipBillingPeriod = "monthly" | "yearly";

export type MembershipPlanDoc = {
  tenant_id: string;
  name: string;
  description: string | null;
  billing_period: MembershipBillingPeriod;
  price_cents: number;
  /** Auto-credited to the member's balance at each renewal. */
  credit_per_period_cents: number;
  /** Whole percent (10 = 10% off). 0 = no discount. */
  service_discount_pct: number;
  retail_discount_pct: number;
  /** Free-form perks the clinic wants to advertise alongside the plan. */
  perks_text: string | null;
  is_active: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
};

export type MembershipStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "paused";

/**
 * Collection: `tenants/{tenantId}/client_memberships`. Doc ID = auto.
 * One row per client × plan. Plan fields are snapshotted so plan edits
 * don't retroactively change a member's terms.
 */
export type ClientMembershipDoc = {
  tenant_id: string;
  client_id: string;
  plan_id: string;
  plan_name_snapshot: string;
  billing_period_snapshot: MembershipBillingPeriod;
  price_cents_snapshot: number;
  status: MembershipStatus;
  started_at: Timestamp;
  current_period_start: Timestamp;
  current_period_end: Timestamp;
  next_renewal_at: Timestamp | null;
  canceled_at: Timestamp | null;
  paused_until: Timestamp | null;
  /** Credit balance the member can apply to invoices. */
  balance_cents: number;
  /** Optional pointer to a Stripe Connect subscription. Null when manually managed. */
  stripe_subscription_id: string | null;
  // Auto-billing (Phase 6.3) — owned card-on-file flow. We save a Customer
  // + PaymentMethod on the connected account at enrollment, and a daily
  // cron charges off-session via PaymentIntent.
  auto_bill: boolean;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  /** Last 4 of the saved card (display only, not auth). */
  card_last4: string | null;
  card_brand: string | null;
  /** Increments on each failed renewal attempt; reset to 0 on success. */
  failed_payment_count: number;
  last_payment_attempt_at: Timestamp | null;
  last_payment_error: string | null;
  notes: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
};

/**
 * Collection: `tenants/{tenantId}/client_memberships/{id}/charges`. Doc ID = auto.
 * Append-only ledger of membership transactions: renewals, manual top-ups,
 * credit redemptions. Lets the owner reconstruct balance history.
 */
export type MembershipChargeType =
  | "renewal"
  | "credit_added"
  | "credit_redeemed"
  | "refund";

export type MembershipChargeDoc = {
  tenant_id: string;
  membership_id: string;
  client_id: string;
  type: MembershipChargeType;
  amount_cents: number; // signed: + add, - redeem
  balance_after_cents: number;
  reason: string | null;
  ref_type: "appointment" | "manual" | "stripe" | null;
  ref_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  created_at: Timestamp;
};

// ─── audit ────────────────────────────────────────────────────────────────────

export type AuditAction =
  | "lead.create"
  | "lead.update"
  | "lead.status_change"
  | "lead.delete"
  | "contact.create"
  | "contact.update"
  | "contact.delete"
  | "company.create"
  | "company.update"
  | "company.delete"
  | "deal.create"
  | "deal.update"
  | "deal.status_change"
  | "note.create"
  | "note.delete"
  | "task.create"
  | "task.complete"
  | "task.delete"
  | "activity.create"
  | "login.success"
  | "login.failure"
  | "logout"
  | "session.revoke"
  | "admin.user_create"
  | "admin.user_suspend"
  | "admin.user_reactivate"
  | "appointment.create"
  | "appointment.update"
  | "appointment.cancel"
  | "appointment.reschedule"
  | "service.create"
  | "service.update"
  | "service.archive"
  | "chart.draft_save"
  | "chart.sign"
  | "embed.book"
  | "product.create"
  | "product.update"
  | "product.archive"
  | "product.movement"
  | "membership_plan.create"
  | "membership_plan.update"
  | "membership_plan.archive"
  | "membership.create"
  | "membership.renew"
  | "membership.cancel"
  | "membership.pause"
  | "membership.charge"
  | "connect.onboard_start"
  | "connect.onboard_complete"
  | "connect.disconnect"
  | "payment.create"
  | "payment.capture"
  | "payment.refund"
  | "payment.fail"
  | "sms.inbound"
  | "sms.outbound"
  | "sms.opt_out"
  | "tenant.update"
  | "provider.availability"
  | "provider.time_off"
  | "package_plan.create"
  | "package_plan.update"
  | "package_plan.archive"
  | "package.purchase"
  | "package.redeem"
  | "gift_card.create"
  | "gift_card.redeem"
  | "review.request_sent"
  | "low_stock.alert_sent"
  | "waitlist.add"
  | "waitlist.notify"
  | "waitlist.remove"
  | "redaction";

/**
 * Collection: `audit_log`. Doc ID = auto.
 * Append-only — security rules deny update + delete. Rows are immutable.
 */
export type AuditLogDoc = {
  actor_user_id: string | null;
  actor_email: string | null;
  action: AuditAction;
  target_type: string | null;
  target_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: Timestamp;
};
