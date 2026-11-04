/**
 * Demo Mode data generator.
 *
 * Pure data construction — returns the structures we'd write to
 * Firestore without doing any I/O. The /api/admin/demo/seed route
 * consumes this and performs the actual writes + Firebase Auth
 * provisioning.
 *
 * Goal: a 100% representative enterprise tenant the super-admin can
 * preview-as any role and see real KPIs, calendars, leads, and ad
 * metrics. Data shape is realistic (60 days of past activity + 14 days
 * of future bookings) so dashboards graph nicely.
 *
 * What's NOT seeded yet (called out in the demo UI):
 *   - Actual photo bytes in GCS — would require image generation +
 *     upload pipeline. PhotoDocs are skipped; the gallery shows empty.
 *   - Stripe payments / Connect onboarding — fake tenant has no Stripe
 *     account; the Billing page surfaces the unconfigured state.
 */

import { randomBytes, randomInt } from "node:crypto";

// ── Constants ───────────────────────────────────────────────────────────────

export const DEMO_TENANT_SLUG = "aesthera-demo";
export const DEMO_TENANT_NAME = "Aesthera Demo Med Spa";
export const DEMO_EMAIL_DOMAIN = "demo.aesthera.io";

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Realistic banks ─────────────────────────────────────────────────────────

const FIRST_NAMES_FEMININE = [
  "Sarah", "Emma", "Olivia", "Sofia", "Maya", "Priya", "Jasmine", "Ava",
  "Isabella", "Mia", "Chloe", "Lily", "Zoe", "Aria", "Harper", "Stella",
  "Camila", "Nora", "Hazel", "Violet", "Maya", "Layla", "Scarlett", "Riley",
];
const FIRST_NAMES_MASC = [
  "Marcus", "James", "Liam", "Noah", "Ethan", "Lucas", "Owen", "Ryan",
  "Sebastian", "Theo", "Wyatt", "Levi", "Jackson", "Caleb", "Asher", "Henry",
];
const FIRST_NAMES_NEUTRAL = ["Jordan", "Alex", "Taylor", "Morgan", "Casey", "Riley", "Avery", "Quinn"];
const LAST_NAMES = [
  "Chen", "Rivera", "Walsh", "Park", "Patel", "Kim", "Nguyen", "Garcia",
  "Sandoval", "O'Connor", "Hayes", "Sullivan", "Williams", "Reyes", "Brooks",
  "Morrison", "Carter", "Bennett", "Hughes", "Foster", "Lee", "Singh",
  "Hernandez", "Martinez", "Cole", "Perez", "Robinson", "Mitchell", "Bailey",
];

const SERVICE_CATALOG: Array<{
  name: string;
  category:
    | "injectables"
    | "facial"
    | "laser"
    | "body"
    | "iv_therapy"
    | "wellness"
    | "consultation";
  duration: number;
  priceCents: number;
  rebookDays: number | null;
}> = [
  { name: "Botox · 30u",         category: "injectables", duration: 30, priceCents: 38000,  rebookDays: 90 },
  { name: "Botox · 50u",         category: "injectables", duration: 30, priceCents: 60000,  rebookDays: 90 },
  { name: "Lip filler · 1ml",    category: "injectables", duration: 45, priceCents: 75000,  rebookDays: 180 },
  { name: "Cheek filler · 2ml",  category: "injectables", duration: 60, priceCents: 145000, rebookDays: 365 },
  { name: "IV Hydration",        category: "iv_therapy",  duration: 30, priceCents: 12500,  rebookDays: 30 },
  { name: "Vitamin B12 IV",      category: "iv_therapy",  duration: 20, priceCents: 8500,   rebookDays: 30 },
  { name: "Microneedling",       category: "facial",      duration: 60, priceCents: 45000,  rebookDays: 30 },
  { name: "Hydrafacial",         category: "facial",      duration: 50, priceCents: 25000,  rebookDays: 30 },
  { name: "Laser hair removal",  category: "laser",       duration: 45, priceCents: 22500,  rebookDays: 42 },
  { name: "Chemical peel",       category: "facial",      duration: 45, priceCents: 18500,  rebookDays: 60 },
  { name: "Skin consultation",   category: "consultation",duration: 30, priceCents: 0,      rebookDays: null },
  { name: "Membership consult",  category: "consultation",duration: 20, priceCents: 0,      rebookDays: null },
];

const PRODUCTS: Array<{
  name: string;
  sku: string;
  unit: "unit" | "ml" | "vial" | "ea" | "syringe";
  onHand: number;
  reorderAt: number;
  costCents: number;
  supplier: string;
}> = [
  { name: "Botox 100u vial",       sku: "BTX-100",  unit: "vial",    onHand: 18, reorderAt: 10, costCents: 47500, supplier: "Allergan" },
  { name: "Juvederm Ultra 1ml",    sku: "JUV-ULT",  unit: "syringe", onHand: 8,  reorderAt: 6,  costCents: 28000, supplier: "Allergan" },
  { name: "Restylane Lyft 1ml",    sku: "RST-LFT",  unit: "syringe", onHand: 5,  reorderAt: 6,  costCents: 30000, supplier: "Galderma" },
  { name: "IV bag · LR 1L",        sku: "IV-LR",    unit: "ea",      onHand: 32, reorderAt: 20, costCents: 1500,  supplier: "McKesson" },
  { name: "B12 1000mcg ampule",    sku: "B12-1K",   unit: "ea",      onHand: 50, reorderAt: 25, costCents: 800,   supplier: "McKesson" },
  { name: "ZO Skin Health serum",  sku: "ZO-SER",   unit: "ea",      onHand: 12, reorderAt: 10, costCents: 8500,  supplier: "ZO Skin Health" },
  { name: "EltaMD UV Clear SPF46", sku: "ELTA-UV",  unit: "ea",      onHand: 24, reorderAt: 15, costCents: 3700,  supplier: "EltaMD" },
];

const LEAD_SOURCES: Array<{ source: "marketing_site" | "referral" | "event" | "other" | "cold"; utm_source: string; utm_medium: string }> = [
  { source: "marketing_site", utm_source: "google",     utm_medium: "cpc" },
  { source: "marketing_site", utm_source: "instagram",  utm_medium: "social" },
  { source: "marketing_site", utm_source: "facebook",   utm_medium: "social" },
  { source: "marketing_site", utm_source: "tiktok",     utm_medium: "social" },
  { source: "referral",       utm_source: "referral",   utm_medium: "word_of_mouth" },
  { source: "marketing_site", utm_source: "google",     utm_medium: "organic" },
  { source: "event",          utm_source: "event",      utm_medium: "in_person" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }
function pickInt(min: number, max: number): number { return min + Math.floor(Math.random() * (max - min + 1)); }
function randPhone(): string {
  return `+1801${String(pickInt(2000000, 9999999)).padStart(7, "0")}`;
}
function randId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}
function randomFullName(): string {
  const fns = [...FIRST_NAMES_FEMININE, ...FIRST_NAMES_MASC, ...FIRST_NAMES_NEUTRAL];
  return `${pick(fns)} ${pick(LAST_NAMES)}`;
}
function emailFromName(name: string, domain = "example.com"): string {
  const [first, last] = name.toLowerCase().split(/\s+/);
  return `${first}.${last}.${randomBytes(2).toString("hex")}@${domain}`;
}

// ── Output shape ────────────────────────────────────────────────────────────

export type SeedUser = {
  email: string;
  fullName: string;
  role: "tenant_owner" | "tenant_manager" | "tenant_provider" | "tenant_front_desk";
  /** Random initial password — surfaced in the seed response so super-admin
   * can demo as that user directly if they don't want to View-as. */
  password: string;
};

export type SeedLocation = {
  id: string;
  name: string;
  city: string;
  state: string;
  postal: string;
  phone: string;
  primary: boolean;
};

export type SeedService = {
  id: string;
  name: string;
  category: string;
  durationMin: number;
  priceCents: number;
  rebookDays: number | null;
};

export type SeedClient = {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  defaultLocationId: string;
  tags: string[];
  emailConsent: boolean;
  smsConsent: boolean;
  createdDaysAgo: number;
};

export type SeedAppointment = {
  id: string;
  clientId: string;
  providerEmail: string;
  locationId: string;
  service: string;
  priceCents: number;
  startsAtMs: number;
  durationMin: number;
  status: "scheduled" | "checked_in" | "in_progress" | "completed" | "no_show" | "cancelled";
  hasChart: boolean;
  chartSigned: boolean;
};

export type SeedLead = {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  company: string;
  source: "marketing_site" | "referral" | "cold" | "partner" | "event" | "other";
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  status: "new" | "contacted" | "qualified" | "demo_booked" | "demo_done" | "closed_won" | "closed_lost" | "no_response";
  createdDaysAgo: number;
};

export type SeedCampaignRun = {
  id: string;
  campaignId: string;
  trigger: "birthday_week" | "post_treatment_21_day" | "reactivation_90_day" | "welcome_new_client" | "upsell_post_visit";
  channel: "email" | "sms";
  clientId: string;
  clientEmail: string;
  status: "queued" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "skipped_cooldown" | "skipped_consent" | "failed";
  sentDaysAgo: number;
};

export type SeedProduct = {
  id: string;
  name: string;
  sku: string;
  unit: "unit" | "ml" | "vial" | "ea" | "syringe";
  onHand: number;
  reorderAt: number;
  costCents: number;
  supplier: string;
};

export type DemoSeed = {
  tenant: { slug: string; name: string };
  users: SeedUser[];
  locations: SeedLocation[];
  services: SeedService[];
  clients: SeedClient[];
  appointments: SeedAppointment[];
  leads: SeedLead[];
  campaignRuns: SeedCampaignRun[];
  products: SeedProduct[];
};

// ── The generator ───────────────────────────────────────────────────────────

export function buildDemoSeed(): DemoSeed {
  // Users (6) — fixed identities so re-seeding produces same emails
  const users: SeedUser[] = [
    { email: `owner@${DEMO_EMAIL_DOMAIN}`,      fullName: "Sarah Chen",      role: "tenant_owner",      password: randomBytes(12).toString("base64url") },
    { email: `manager@${DEMO_EMAIL_DOMAIN}`,    fullName: "Marcus Rivera",   role: "tenant_manager",    password: randomBytes(12).toString("base64url") },
    { email: `dr.walsh@${DEMO_EMAIL_DOMAIN}`,   fullName: "Dr. Jamiefer Walsh", role: "tenant_provider", password: randomBytes(12).toString("base64url") },
    { email: `dr.park@${DEMO_EMAIL_DOMAIN}`,    fullName: "Dr. Alex Park",   role: "tenant_provider",   password: randomBytes(12).toString("base64url") },
    { email: `frontdesk1@${DEMO_EMAIL_DOMAIN}`, fullName: "Maya Patel",      role: "tenant_front_desk", password: randomBytes(12).toString("base64url") },
    { email: `frontdesk2@${DEMO_EMAIL_DOMAIN}`, fullName: "Jordan Kim",      role: "tenant_front_desk", password: randomBytes(12).toString("base64url") },
  ];

  // Locations (2)
  const locations: SeedLocation[] = [
    { id: randId("loc"), name: "Park City",  city: "Park City",      state: "UT", postal: "84060", phone: "+14355552100", primary: true  },
    { id: randId("loc"), name: "Salt Lake",  city: "Salt Lake City", state: "UT", postal: "84111", phone: "+18015552200", primary: false },
  ];

  // Services
  const services: SeedService[] = SERVICE_CATALOG.map((s) => ({
    id: randId("svc"),
    name: s.name,
    category: s.category,
    durationMin: s.duration,
    priceCents: s.priceCents,
    rebookDays: s.rebookDays,
  }));

  // Products
  const products: SeedProduct[] = PRODUCTS.map((p) => ({
    id: randId("prod"),
    name: p.name,
    sku: p.sku,
    unit: p.unit,
    onHand: p.onHand,
    reorderAt: p.reorderAt,
    costCents: p.costCents,
    supplier: p.supplier,
  }));

  // Clients (35) — created over the past 180 days, distributed across locations
  const clients: SeedClient[] = Array.from({ length: 35 }, () => {
    const fullName = randomFullName();
    return {
      id: randId("cli"),
      email: emailFromName(fullName, "example.com"),
      fullName,
      phone: randPhone(),
      defaultLocationId: pick(locations).id,
      tags: pickTags(),
      emailConsent: Math.random() > 0.15,
      smsConsent: Math.random() > 0.30,
      createdDaysAgo: pickInt(7, 180),
    };
  });

  // Appointments — spread across past 60 days + future 14 days, split between providers
  const providerEmails = users.filter((u) => u.role === "tenant_provider").map((u) => u.email);
  const appointments: SeedAppointment[] = [];
  // 90 past + 25 future = 115 total
  for (let i = 0; i < 90; i++) {
    const daysAgo = pickInt(0, 60);
    const hour = pickInt(9, 17);
    const minute = pick([0, 15, 30, 45]);
    const start = Date.now() - daysAgo * DAY_MS;
    const d = new Date(start);
    d.setHours(hour, minute, 0, 0);
    const svc = pick(services);
    const status = weightedStatus(daysAgo);
    const hasChart = status === "completed" || status === "in_progress";
    appointments.push({
      id: randId("appt"),
      clientId: pick(clients).id,
      providerEmail: pick(providerEmails),
      locationId: pick(locations).id,
      service: svc.name,
      priceCents: svc.priceCents,
      startsAtMs: d.getTime(),
      durationMin: svc.durationMin,
      status,
      hasChart,
      chartSigned: hasChart && Math.random() > 0.25,
    });
  }
  for (let i = 0; i < 25; i++) {
    const daysAhead = pickInt(0, 14);
    const hour = pickInt(9, 17);
    const minute = pick([0, 15, 30, 45]);
    const start = Date.now() + daysAhead * DAY_MS;
    const d = new Date(start);
    d.setHours(hour, minute, 0, 0);
    const svc = pick(services);
    appointments.push({
      id: randId("appt"),
      clientId: pick(clients).id,
      providerEmail: pick(providerEmails),
      locationId: pick(locations).id,
      service: svc.name,
      priceCents: svc.priceCents,
      startsAtMs: d.getTime(),
      durationMin: svc.durationMin,
      status: "scheduled",
      hasChart: false,
      chartSigned: false,
    });
  }

  // Leads (40) over past 90 days — distribution mirrors a real funnel
  const leads: SeedLead[] = Array.from({ length: 40 }, () => {
    const fullName = randomFullName();
    const src = pick(LEAD_SOURCES);
    return {
      id: randId("lead"),
      email: emailFromName(fullName, "example.com"),
      fullName,
      phone: randPhone(),
      company: `${pick(LAST_NAMES)} Aesthetics`,
      source: src.source,
      utm_source: src.utm_source,
      utm_medium: src.utm_medium,
      utm_campaign: pick(["spring-2026", "founding-25", "instagram-reels", "google-search", "referral-rewards"]),
      status: weightedLeadStatus(),
      createdDaysAgo: pickInt(0, 90),
    };
  });

  // Campaign runs (60) — 5 trigger types, mix of channels + statuses
  const triggers: SeedCampaignRun["trigger"][] = [
    "birthday_week",
    "post_treatment_21_day",
    "reactivation_90_day",
    "welcome_new_client",
    "upsell_post_visit",
  ];
  const campaignIds = triggers.map(() => randId("camp"));
  const campaignRuns: SeedCampaignRun[] = Array.from({ length: 60 }, () => {
    const ti = pickInt(0, triggers.length - 1);
    const c = pick(clients);
    return {
      id: randId("run"),
      campaignId: campaignIds[ti],
      trigger: triggers[ti],
      channel: Math.random() > 0.35 ? "email" : "sms",
      clientId: c.id,
      clientEmail: c.email,
      status: weightedRunStatus(),
      sentDaysAgo: pickInt(0, 60),
    };
  });

  return {
    tenant: { slug: DEMO_TENANT_SLUG, name: DEMO_TENANT_NAME },
    users,
    locations,
    services,
    clients,
    appointments,
    leads,
    campaignRuns,
    products,
  };
}

// ── Distribution helpers ────────────────────────────────────────────────────

function pickTags(): string[] {
  const all = ["vip", "first-visit", "membership", "botox-regular", "filler-regular", "post-care-followup", "complaint-resolved"];
  const n = pickInt(0, 3);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = pick(all);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function weightedStatus(daysAgo: number): SeedAppointment["status"] {
  // Past 0-1 days: ~50% checked_in/in_progress, rest completed
  // Past 2+ days: ~78% completed, 8% cancelled, 8% no_show, 6% checked_in (lingering)
  if (daysAgo <= 1) {
    const r = Math.random();
    if (r < 0.4) return "completed";
    if (r < 0.7) return "checked_in";
    if (r < 0.92) return "in_progress";
    return "scheduled";
  }
  const r = Math.random();
  if (r < 0.78) return "completed";
  if (r < 0.86) return "cancelled";
  if (r < 0.94) return "no_show";
  return "checked_in";
}

function weightedLeadStatus(): SeedLead["status"] {
  const r = Math.random();
  if (r < 0.30) return "new";
  if (r < 0.50) return "contacted";
  if (r < 0.65) return "qualified";
  if (r < 0.75) return "demo_booked";
  if (r < 0.83) return "demo_done";
  if (r < 0.90) return "closed_won";
  if (r < 0.97) return "closed_lost";
  return "no_response";
}

function weightedRunStatus(): SeedCampaignRun["status"] {
  const r = Math.random();
  if (r < 0.35) return "opened";
  if (r < 0.50) return "clicked";
  if (r < 0.78) return "delivered";
  if (r < 0.85) return "sent";
  if (r < 0.92) return "skipped_cooldown";
  if (r < 0.97) return "skipped_consent";
  return "bounced";
}

// Re-export randomInt so the API route can mirror Distribution helpers if needed
void randomInt;
