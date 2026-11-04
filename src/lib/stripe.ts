/**
 * Stripe wrapper — server-side only.
 *
 * Lazy-initialized so the module is importable in environments without
 * STRIPE_SECRET_KEY (e.g. local dev without Stripe configured). Throws
 * with a clear message if a Stripe call is attempted without keys.
 *
 * NOT Stripe Connect — this is plain subscription billing for the
 * platform itself (clinics pay Aesthera). Future Phase 5+: Connect for
 * clinics to charge their own patients.
 */

import Stripe from "stripe";
import type { TenantSubscriptionTier } from "./firestore-types";

let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY in Cloud Run env or Secret Manager.",
    );
  }
  cached = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  return cached;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Map subscription tier → Stripe Price ID. Cory creates the Prices in
 * Stripe Dashboard and sets these env vars (Cloud Run + Secret Manager).
 *
 * Mapping is intentionally code-side (not DB) so a misconfigured price
 * fails loudly during checkout instead of silently mis-billing a tenant.
 */
export function getPriceIdForTier(tier: TenantSubscriptionTier): string | null {
  switch (tier) {
    case "founding_25":
      return process.env.STRIPE_PRICE_FOUNDING_25 || null;
    case "basic":
      return process.env.STRIPE_PRICE_BASIC || null;
    case "growth":
      return process.env.STRIPE_PRICE_GROWTH || null;
    case "enterprise":
      return process.env.STRIPE_PRICE_ENTERPRISE || null;
  }
}

export const TIER_DISPLAY: Record<
  TenantSubscriptionTier,
  { name: string; price_display: string; tagline: string; features: string[] }
> = {
  founding_25: {
    name: "Founding 25",
    price_display: "$99/mo for life",
    tagline: "First 25 clinics — locked-in pricing forever",
    features: [
      "Everything in Enterprise — unlocked",
      "Unlimited locations, providers, clients",
      "Unlimited AI (SOAP drafts, marketing emails, concierge)",
      "All marketing channels + Stripe Connect + SSO + API",
      "Priority support · permanent price lock",
    ],
  },
  basic: {
    name: "Basic",
    price_display: "$199/mo",
    tagline: "For solo or single-location clinics",
    features: [
      "1 location · up to 3 providers · 1,000 client records",
      "50 AI SOAP drafts + 2,000 AI marketing emails / month",
      "500 AI concierge turns/month · embed widget",
      "Email + 2 social channels (Meta, X, etc.)",
      "Photos + before/after, digital consents, inventory",
      "30-day reports · SMS reminders",
    ],
  },
  growth: {
    name: "Growth",
    price_display: "$399/mo",
    tagline: "For multi-location practices",
    features: [
      "5 locations · unlimited providers · 10,000 client records",
      "500 AI SOAP drafts + 7,500 AI marketing emails / month",
      "5,000 AI concierge turns/month · drip sequences",
      "Email + 3 social channels · 90-day reports",
      "Photos, consents, inventory, memberships",
      "Stripe Connect (clinic-to-patient billing) · read-only API",
    ],
  },
  enterprise: {
    name: "Enterprise",
    price_display: "$899/mo",
    tagline: "For groups + DSO-managed practices",
    features: [
      "Unlimited locations, providers, clients",
      "Unlimited AI (SOAP, marketing, concierge)",
      "All marketing channels · full API + webhooks",
      "SSO · dedicated CSM · quarterly business review",
      "All clinical features + Stripe Connect",
      "SOC 2 paperwork · custom integrations",
    ],
  },
};

/**
 * Translate a Stripe subscription status into our TenantStatus.
 * Aesthera doesn't model every Stripe status — we collapse them.
 */
export function mapStripeStatus(
  stripeStatus: Stripe.Subscription.Status | null,
): "active" | "trialing" | "paused" | "cancelled" {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "paused":
      return "paused";
    case "past_due":
    case "unpaid":
      return "active"; // Stripe + we still consider this serving — dunning handles it
    case "canceled":
    case "incomplete":
    case "incomplete_expired":
      return "cancelled";
    default:
      return "cancelled";
  }
}

/**
 * Resolve the Aesthera subscription tier from a Stripe Price ID by
 * walking the env vars. Returns null if no mapping matches.
 */
export function tierFromPriceId(priceId: string): TenantSubscriptionTier | null {
  if (priceId === process.env.STRIPE_PRICE_FOUNDING_25) return "founding_25";
  if (priceId === process.env.STRIPE_PRICE_BASIC) return "basic";
  if (priceId === process.env.STRIPE_PRICE_GROWTH) return "growth";
  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) return "enterprise";
  return null;
}

// ─── Stripe Connect (Phase 6.1) ───────────────────────────────────────────────

/**
 * Aesthera takes 2.5% + Stripe's standard 2.9% + 30¢ on every clinic
 * charge. The 2.5% is our application fee on Connect; the rest flows
 * to Stripe and the clinic. Founding 25 gets 0% application fee
 * (rewarded for early adoption).
 */
export function applicationFeeBps(tier: TenantSubscriptionTier): number {
  if (tier === "founding_25") return 0;
  if (tier === "enterprise") return 150; // 1.5%
  return 250; // 2.5% for basic + growth
}

export function calcApplicationFeeCents(
  amountCents: number,
  tier: TenantSubscriptionTier,
): number {
  return Math.round((amountCents * applicationFeeBps(tier)) / 10_000);
}

/**
 * Create a Connect account for a tenant — V2 API.
 *
 * Uses `defaults.responsibilities = { fees_collector: 'stripe', losses_collector: 'stripe' }`
 * so Stripe (not Aesthera) absorbs disputes/chargebacks at the platform level.
 * This is what bypasses the Stripe Connect "platform profile" pre-flight check
 * that V1 Express accounts require — Stripe doesn't need Aesthera to attest
 * to liability for losses if Stripe is the losses_collector.
 *
 * Returns the V2 account ID (still `acct_*`).
 *
 * Docs: https://docs.stripe.com/api/v2/core/accounts
 */
export async function createConnectAccount(args: {
  tenantSlug: string;
  ownerEmail: string;
  tenantName: string;
}): Promise<string> {
  const account = await stripe().v2.core.accounts.create({
    display_name: args.tenantName,
    contact_email: args.ownerEmail,
    identity: {
      country: "us",
    },
    dashboard: "full",
    defaults: {
      responsibilities: {
        fees_collector: "stripe",
        losses_collector: "stripe",
      },
    },
    configuration: {
      customer: {},
      merchant: {
        capabilities: {
          card_payments: {
            requested: true,
          },
        },
      },
    },
    metadata: {
      aesthera_tenant_slug: args.tenantSlug,
    },
  });
  return account.id;
}

/**
 * Build a V2 Account Link for hosted onboarding. The owner is redirected
 * to Stripe-hosted KYC then back to the platform.
 */
export async function createOnboardingLink(args: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}): Promise<string> {
  const link = await stripe().v2.core.accountLinks.create({
    account: args.accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations: ["merchant", "customer"],
        refresh_url: args.refreshUrl,
        return_url: args.returnUrl,
      },
    },
  });
  return link.url;
}

/**
 * For V2 accounts with `dashboard: 'full'` the connected account has its
 * own Stripe dashboard login (separate from the platform). We don't mint
 * single-use login links anymore — the owner signs in at dashboard.stripe.com
 * with the email tied to the connected account.
 *
 * For continuity we still expose this helper; it returns the deep-link to
 * the account in the platform's dashboard view (only works when the calling
 * Stripe user is a member of the connected account or the platform).
 */
export async function createLoginLink(accountId: string): Promise<string> {
  return `https://dashboard.stripe.com/${encodeURIComponent(accountId)}`;
}

/**
 * Pull the latest V2 account state and project it back onto Aesthera's
 * tenant flag shape (charges_enabled / payouts_enabled / details_submitted).
 *
 * V2 model:
 *   - charges_enabled  ← configuration.merchant.capabilities.card_payments.status === 'active'
 *   - details_submitted ← requirements.summary.minimum_deadline.status NOT in {currently_due, past_due}
 *   - payouts_enabled  — V2 with losses_collector=stripe defers payouts to Stripe-managed dashboard;
 *                        we infer from charges_enabled for now and refine when we wire payout config.
 */
export async function fetchConnectStatus(
  accountId: string,
): Promise<{
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
}> {
  const acc = await stripe().v2.core.accounts.retrieve(accountId, {
    include: ["configuration.merchant", "requirements"],
  });
  const cardStatus =
    acc?.configuration?.merchant?.capabilities?.card_payments?.status;
  const reqStatus = acc?.requirements?.summary?.minimum_deadline?.status;
  const chargesEnabled = cardStatus === "active";
  const detailsSubmitted =
    reqStatus !== "currently_due" && reqStatus !== "past_due";
  return {
    charges_enabled: chargesEnabled,
    // V2 + losses_collector=stripe: payouts are Stripe-managed; treat as enabled
    // once card_payments is active. Refine if we add explicit payout configuration.
    payouts_enabled: chargesEnabled,
    details_submitted: detailsSubmitted,
  };
}
