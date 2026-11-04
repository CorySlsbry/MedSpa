/**
 * Per-tier feature limits + enforcement helpers. Single source of truth
 * for what each Aesthera subscription tier gates. UI copy in stripe.ts
 * (TIER_DISPLAY) should track this, but limit checks always read here.
 *
 * Two kinds of limits:
 *   1. Resource limits (locations, providers, active clients) — checked
 *      against current count in Firestore at create time.
 *   2. Monthly usage limits (AI drafts, marketing emails, concierge turns)
 *      — tracked in tenants/{slug}/usage/{yyyy_mm} doc, incremented on
 *      success.
 *
 * Plus boolean feature flags (photos, consents, inventory, memberships,
 * SSO, API).
 *
 * `null` always means "unlimited" — never use 0 or -1 to signal that.
 */

import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db, now } from "./firestore";
import { tenantCol, getTenant } from "./tenant";
import type { TenantDoc, TenantSubscriptionTier, UsageDoc } from "./firestore-types";

export type SocialChannelGate = "email_only" | { socials: number } | "all";

export type TierLimits = {
  /** Active locations the tenant can have (active = is_active=true). */
  max_locations: number | null;
  /** Active providers. */
  max_providers: number | null;
  /** Total client records (we don't filter by activity — count is total). */
  max_active_clients: number | null;
  /** AI draft + marketing email + concierge per CALENDAR MONTH (UTC). */
  max_ai_soap_drafts_per_month: number | null;
  max_ai_marketing_emails_per_month: number | null;
  max_ai_concierge_turns_per_month: number | null;
  /** Persistent CampaignDocs. */
  max_persistent_campaigns: number | null;
  /** Steps in a single drip sequence. */
  max_drip_steps_per_campaign: number | null;
  /** Connected social-channel integrations (does NOT include built-in email). */
  max_marketing_channels: number | null;
  /** Reports time-range cap in days. */
  reports_range_days: number;
  /** Hard binary feature flags. */
  features: {
    photos_before_after: boolean;
    digital_consents: boolean;
    inventory: boolean;
    memberships: boolean;
    api_access: "none" | "read" | "full";
    sso: boolean;
    stripe_connect: boolean;
  };
};

const UNLIMITED = null;

export const TIER_LIMITS: Record<TenantSubscriptionTier, TierLimits> = {
  founding_25: {
    max_locations: UNLIMITED,
    max_providers: UNLIMITED,
    max_active_clients: UNLIMITED,
    max_ai_soap_drafts_per_month: UNLIMITED,
    max_ai_marketing_emails_per_month: UNLIMITED,
    max_ai_concierge_turns_per_month: UNLIMITED,
    max_persistent_campaigns: UNLIMITED,
    max_drip_steps_per_campaign: UNLIMITED,
    max_marketing_channels: UNLIMITED,
    reports_range_days: 36500,
    features: {
      photos_before_after: true,
      digital_consents: true,
      inventory: true,
      memberships: true,
      api_access: "full",
      sso: true,
      stripe_connect: true,
    },
  },
  basic: {
    max_locations: 1,
    max_providers: 3,
    max_active_clients: 1000,
    max_ai_soap_drafts_per_month: 50,
    max_ai_marketing_emails_per_month: 2000,
    max_ai_concierge_turns_per_month: 500,
    max_persistent_campaigns: 2,
    max_drip_steps_per_campaign: 1,
    max_marketing_channels: 2,
    reports_range_days: 30,
    features: {
      photos_before_after: true,
      digital_consents: true,
      inventory: true,
      memberships: false,
      api_access: "none",
      sso: false,
      stripe_connect: false,
    },
  },
  growth: {
    max_locations: 5,
    max_providers: UNLIMITED,
    max_active_clients: 10000,
    max_ai_soap_drafts_per_month: 500,
    max_ai_marketing_emails_per_month: 7500,
    max_ai_concierge_turns_per_month: 5000,
    max_persistent_campaigns: 10,
    max_drip_steps_per_campaign: 5,
    max_marketing_channels: 3,
    reports_range_days: 90,
    features: {
      photos_before_after: true,
      digital_consents: true,
      inventory: true,
      memberships: true,
      api_access: "read",
      sso: false,
      stripe_connect: true,
    },
  },
  enterprise: {
    max_locations: UNLIMITED,
    max_providers: UNLIMITED,
    max_active_clients: UNLIMITED,
    max_ai_soap_drafts_per_month: UNLIMITED,
    max_ai_marketing_emails_per_month: UNLIMITED,
    max_ai_concierge_turns_per_month: UNLIMITED,
    max_persistent_campaigns: UNLIMITED,
    max_drip_steps_per_campaign: UNLIMITED,
    max_marketing_channels: UNLIMITED,
    reports_range_days: 36500,
    features: {
      photos_before_after: true,
      digital_consents: true,
      inventory: true,
      memberships: true,
      api_access: "full",
      sso: true,
      stripe_connect: true,
    },
  },
};

export function limitsFor(tenant: Pick<TenantDoc, "subscription_tier">): TierLimits {
  return TIER_LIMITS[tenant.subscription_tier] ?? TIER_LIMITS.basic;
}

export type LimitCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "quota_exceeded" | "feature_unavailable";
      message: string;
      limit: number | null;
      current?: number;
      upgrade_to?: TenantSubscriptionTier;
    };

/**
 * Check a numeric limit against current count. Returns ok:true if
 * unlimited (null) or if (current + 1) <= limit.
 */
export function checkResourceLimit(args: {
  tier: TenantSubscriptionTier;
  field:
    | "max_locations"
    | "max_providers"
    | "max_active_clients"
    | "max_persistent_campaigns"
    | "max_marketing_channels";
  current: number;
}): LimitCheck {
  const limits = TIER_LIMITS[args.tier];
  const cap = limits[args.field];
  if (cap === null) return { ok: true };
  if (args.current + 1 <= cap) return { ok: true };
  const upgradeTo: TenantSubscriptionTier =
    args.tier === "basic" ? "growth" : args.tier === "growth" ? "enterprise" : "enterprise";
  return {
    ok: false,
    reason: "quota_exceeded",
    message: humanLimitMessage(args.field, cap, args.tier, upgradeTo),
    limit: cap,
    current: args.current,
    upgrade_to: upgradeTo,
  };
}

/**
 * Check a feature flag. Boolean flags only.
 */
export function checkFeature(args: {
  tier: TenantSubscriptionTier;
  feature: keyof TierLimits["features"];
}): LimitCheck {
  const limits = TIER_LIMITS[args.tier];
  const v = limits.features[args.feature];
  if (typeof v === "boolean" ? v : v !== "none") return { ok: true };
  const upgradeTo: TenantSubscriptionTier =
    args.tier === "basic" ? "growth" : args.tier === "growth" ? "enterprise" : "enterprise";
  return {
    ok: false,
    reason: "feature_unavailable",
    message: `${humanFeatureName(args.feature)} isn't available on the ${args.tier.replace(/_/g, "-")} plan. Upgrade to ${upgradeTo.replace(/_/g, "-")} to enable it.`,
    limit: null,
    upgrade_to: upgradeTo,
  };
}

/**
 * Read this month's usage counter. Cheap — single doc get.
 */
export async function readMonthlyUsage(tenantId: string): Promise<UsageDoc> {
  const period = currentPeriod();
  const ref = tenantCol(tenantId, "usage").doc(period);
  const snap = await ref.get();
  if (!snap.exists) {
    return {
      tenant_id: tenantId,
      period,
      ai_soap_drafts: 0,
      ai_marketing_emails: 0,
      ai_concierge_turns: 0,
      sms_sent: 0,
      updated_at: Timestamp.now(),
    };
  }
  return snap.data() as UsageDoc;
}

/**
 * Check a monthly-quota limit BEFORE the operation. Returns ok:true if
 * unlimited or under the cap. Pass `headroom=1` to check "can I do one
 * more right now"; bump higher for bulk batches.
 */
export async function checkMonthlyUsage(args: {
  tenantId: string;
  tier: TenantSubscriptionTier;
  field: "ai_soap_drafts" | "ai_marketing_emails" | "ai_concierge_turns";
  headroom?: number;
}): Promise<LimitCheck> {
  const cap = capForUsage(args.tier, args.field);
  if (cap === null) return { ok: true };
  const usage = await readMonthlyUsage(args.tenantId);
  const current = usage[args.field] ?? 0;
  const wantTo = current + (args.headroom ?? 1);
  if (wantTo <= cap) return { ok: true };
  const upgradeTo: TenantSubscriptionTier =
    args.tier === "basic" ? "growth" : args.tier === "growth" ? "enterprise" : "enterprise";
  return {
    ok: false,
    reason: "quota_exceeded",
    message: humanUsageMessage(args.field, cap, args.tier, upgradeTo),
    limit: cap,
    current,
    upgrade_to: upgradeTo,
  };
}

/**
 * Increment a monthly usage counter atomically. Idempotent on the doc
 * layer (creates if missing). Call AFTER the operation succeeds.
 */
export async function bumpMonthlyUsage(args: {
  tenantId: string;
  field: "ai_soap_drafts" | "ai_marketing_emails" | "ai_concierge_turns" | "sms_sent";
  by?: number;
}): Promise<void> {
  const period = currentPeriod();
  const ref = tenantCol(args.tenantId, "usage").doc(period);
  await ref.set(
    {
      tenant_id: args.tenantId,
      period,
      [args.field]: FieldValue.increment(args.by ?? 1),
      updated_at: now(),
    },
    { merge: true },
  );
}

/**
 * Convenience: fetch tenant + run a resource-limit check in one call.
 * Used by API endpoints that don't already have the tenant doc loaded.
 */
export async function checkResourceLimitForTenant(args: {
  tenantId: string;
  field: Parameters<typeof checkResourceLimit>[0]["field"];
  current: number;
}): Promise<LimitCheck> {
  const t = await getTenant(args.tenantId);
  if (!t) return { ok: false, reason: "feature_unavailable", message: "Tenant not found.", limit: null };
  return checkResourceLimit({ tier: t.subscription_tier, field: args.field, current: args.current });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function capForUsage(
  tier: TenantSubscriptionTier,
  field: "ai_soap_drafts" | "ai_marketing_emails" | "ai_concierge_turns",
): number | null {
  const limits = TIER_LIMITS[tier];
  if (field === "ai_soap_drafts") return limits.max_ai_soap_drafts_per_month;
  if (field === "ai_marketing_emails") return limits.max_ai_marketing_emails_per_month;
  if (field === "ai_concierge_turns") return limits.max_ai_concierge_turns_per_month;
  return null;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function humanLimitMessage(
  field: string,
  cap: number,
  tier: TenantSubscriptionTier,
  upgrade: TenantSubscriptionTier,
): string {
  const label = humanFieldName(field);
  return `Your ${tier.replace(/_/g, "-")} plan is limited to ${cap.toLocaleString()} ${label}. Upgrade to ${upgrade.replace(/_/g, "-")} for more.`;
}

function humanUsageMessage(
  field: string,
  cap: number,
  tier: TenantSubscriptionTier,
  upgrade: TenantSubscriptionTier,
): string {
  const label = humanUsageName(field);
  return `You've used your ${tier.replace(/_/g, "-")} plan's ${cap.toLocaleString()} ${label}/month allowance. Upgrade to ${upgrade.replace(/_/g, "-")} or wait until next month.`;
}

function humanFieldName(field: string): string {
  switch (field) {
    case "max_locations": return "locations";
    case "max_providers": return "providers";
    case "max_active_clients": return "client records";
    case "max_persistent_campaigns": return "active campaigns";
    case "max_marketing_channels": return "connected social channels";
    default: return field.replace(/^max_/, "").replace(/_/g, " ");
  }
}

function humanUsageName(field: string): string {
  switch (field) {
    case "ai_soap_drafts": return "AI SOAP drafts";
    case "ai_marketing_emails": return "AI marketing emails";
    case "ai_concierge_turns": return "AI concierge turns";
    default: return field.replace(/_/g, " ");
  }
}

function humanFeatureName(feature: keyof TierLimits["features"]): string {
  switch (feature) {
    case "photos_before_after": return "Photo + before/after pairing";
    case "digital_consents": return "Digital consent forms";
    case "inventory": return "Inventory tracking";
    case "memberships": return "Membership management";
    case "api_access": return "API access";
    case "sso": return "SSO";
    case "stripe_connect": return "Stripe Connect (clinic→patient billing)";
  }
}
