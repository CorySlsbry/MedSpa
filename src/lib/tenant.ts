/**
 * Tenant utilities — server-side helpers for the multi-tenant SaaS layer
 * (Phase 2). Currently provides:
 *   - slug generation for tenant doc IDs
 *   - tenant context resolution from a session user's custom claims
 *   - convenience helpers for tenant-scoped queries
 *
 * The data model lives in firestore-types.ts under TenantDoc and the
 * subcollections (locations, providers, clients, appointments).
 */

import { db, now } from "./firestore";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import type {
  CompanyType,
  TenantDoc,
  TenantSubscriptionTier,
  UserRole,
} from "./firestore-types";

function initFirebaseAdmin() {
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

/** Convert a tenant name to a URL-safe, deterministic slug. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

/** Append a numeric suffix to a slug if one already exists. */
export async function uniqueTenantSlug(base: string): Promise<string> {
  const baseSlug = slugify(base);
  if (!baseSlug) throw new Error("Tenant name produces empty slug.");
  let candidate = baseSlug;
  for (let i = 2; i < 50; i++) {
    const snap = await db().collection("tenants").doc(candidate).get();
    if (!snap.exists) return candidate;
    candidate = `${baseSlug}-${i}`;
  }
  throw new Error("Could not allocate a unique tenant slug.");
}

/**
 * Set the tenant_id + role custom claims on a Firebase user. Used when
 * provisioning a new tenant owner or adding a provider/client to a tenant.
 *
 * Existing tokens won't have the new claims until they refresh (~1 hr) or
 * the user signs back in.
 */
export async function setTenantClaims(
  firebaseUid: string,
  tenantId: string,
  role: UserRole,
): Promise<void> {
  initFirebaseAdmin();
  // Refuse to overwrite a super-admin role — admin and tenant claims must
  // never coexist on the same user. Auto-provisioning enforces this upstream
  // (see AdminEmailNotProvisionable in provisionTenantForOwner), but we also
  // hard-block here so any caller path that bypasses provision still trips.
  const existing = await getAuth().getUser(firebaseUid);
  const prior = (existing.customClaims ?? {}) as { role?: string };
  if (prior.role === "super_admin") {
    throw new Error(
      `Refusing to set ${role} claim on user with super_admin role (uid=${firebaseUid}).`,
    );
  }
  await getAuth().setCustomUserClaims(firebaseUid, { tenant_id: tenantId, role });
}

/**
 * Look up a tenant doc by ID. Returns null if not found.
 */
export async function getTenant(tenantId: string): Promise<(TenantDoc & { id: string }) | null> {
  const snap = await db().collection("tenants").doc(tenantId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as TenantDoc) };
}

/**
 * Helper for tenant-scoped collection refs:
 *   tenantCol(tenantId, "clients")
 *   tenantCol(tenantId, "appointments")
 */
export function tenantCol(tenantId: string, sub: string) {
  return db().collection("tenants").doc(tenantId).collection(sub);
}

/**
 * Provision a tenant + tenant_owner Firebase user atomically.
 *
 * Idempotent on owner_email: if the email already has a tenant_owner claim
 * pointing at an existing tenant doc, returns that existing tenant instead of
 * creating a new one. This makes the demo form safe to submit multiple times
 * — repeats just refresh the magic link rather than spawning duplicate clinics.
 *
 * Used by:
 *   - POST /api/admin/tenants (super-admin manual provisioning)
 *   - POST /api/demo (auto-provisioning on inbound lead capture)
 */
export type ProvisionTenantArgs = {
  clinicName: string;
  clinicType: CompanyType;
  ownerEmail: string;
  ownerFullName: string;
  subscriptionTier?: TenantSubscriptionTier;
  timezone?: string;
  trialDays?: number;
};

export type ProvisionTenantResult = {
  slug: string;
  ownerUid: string;
  alreadyExisted: boolean;
  isNewUser: boolean;
  tenant: TenantDoc & { id: string };
};

function randomTempPassword(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < arr.length; i++) {
    out += charset[arr[i] % charset.length];
  }
  return out;
}

/**
 * Refuse to auto-provision a tenant for a super-admin email or for any
 * existing super-admin user. Super-admin must always remain admin-only;
 * mixing tenant_owner with super_admin claims breaks the role-based redirect
 * and can route an admin into a tenant portal (or vice versa).
 *
 * The bootstrap allowlist is the source of truth — any email in the
 * comma-separated ADMIN_BOOTSTRAP_EMAIL env var is blocked, and any user
 * whose existing claim is `role: "super_admin"` is blocked.
 */
function isAdminEmail(email: string): boolean {
  const allow = (process.env.ADMIN_BOOTSTRAP_EMAIL || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}

export class AdminEmailNotProvisionable extends Error {
  constructor(email: string) {
    super(`Email ${email} belongs to the platform admin and cannot be provisioned as a tenant.`);
    this.name = "AdminEmailNotProvisionable";
  }
}

export async function provisionTenantForOwner(
  args: ProvisionTenantArgs,
): Promise<ProvisionTenantResult> {
  initFirebaseAdmin();
  const tier: TenantSubscriptionTier = args.subscriptionTier ?? "founding_25";
  const timezone = args.timezone ?? "America/Denver";
  const trialDays = args.trialDays ?? 14;

  // Hard guard: never provision a tenant for a super-admin email
  if (isAdminEmail(args.ownerEmail)) {
    throw new AdminEmailNotProvisionable(args.ownerEmail);
  }

  // 1. Find or create Firebase user
  let ownerUid: string;
  let isNewUser = false;
  try {
    const existing = await getAuth().getUserByEmail(args.ownerEmail);
    ownerUid = existing.uid;
    // Second guard: if the existing user already has super_admin role, refuse
    const existingClaims = (existing.customClaims ?? {}) as { role?: string };
    if (existingClaims.role === "super_admin") {
      throw new AdminEmailNotProvisionable(args.ownerEmail);
    }
  } catch (err) {
    if (err instanceof AdminEmailNotProvisionable) throw err;
    if ((err as { code?: string }).code !== "auth/user-not-found") {
      throw err;
    }
    const newUser = await getAuth().createUser({
      email: args.ownerEmail,
      emailVerified: false,
      password: randomTempPassword(),
      displayName: args.ownerFullName,
    });
    ownerUid = newUser.uid;
    isNewUser = true;
  }

  // 2. If the user already owns a tenant, return that one (idempotent re-entry)
  const userRecord = await getAuth().getUser(ownerUid);
  const claims = (userRecord.customClaims ?? {}) as {
    tenant_id?: string;
    role?: string;
  };
  if (claims.tenant_id && claims.role === "tenant_owner") {
    const snap = await db().collection("tenants").doc(claims.tenant_id).get();
    if (snap.exists) {
      return {
        slug: claims.tenant_id,
        ownerUid,
        alreadyExisted: true,
        isNewUser,
        tenant: { id: snap.id, ...(snap.data() as TenantDoc) },
      };
    }
    // Stale claim with no tenant doc — fall through and create fresh.
  }

  // 3. New tenant — allocate slug
  const slug = await uniqueTenantSlug(args.clinicName);

  // 4. Set custom claims so the magic-link callback can route to /owner
  await setTenantClaims(ownerUid, slug, "tenant_owner");

  // 5. Build + write the tenant doc
  const trialEnd =
    trialDays > 0 ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null;

  const tenantDoc: Omit<TenantDoc, "created_at" | "updated_at"> & {
    created_at: ReturnType<typeof now>;
    updated_at: ReturnType<typeof now>;
  } = {
    name: args.clinicName,
    slug,
    type: args.clinicType,
    owner_user_id: ownerUid,
    owner_email: args.ownerEmail,
    subscription_tier: tier,
    subscription_status: trialDays > 0 ? "trialing" : "active",
    trial_ends_at: trialEnd ? Timestamp.fromDate(trialEnd) : null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_connect_account_id: null,
    stripe_connect_charges_enabled: false,
    stripe_connect_payouts_enabled: false,
    stripe_connect_details_submitted: false,
    primary_color: null,
    logo_url: null,
    timezone,
    hipaa_baa_signed_at: null,
    twilio_phone_number: null,
    twilio_subaccount_sid: null,
    twilio_subaccount_auth_token_enc: null,
    google_review_url: null,
    onboarded_at: null,
    menu_overrides: null,
    menu_lock_owner_only: false,
    created_at: now(),
    updated_at: now(),
  };

  await db().collection("tenants").doc(slug).create(tenantDoc);

  return {
    slug,
    ownerUid,
    alreadyExisted: false,
    isNewUser,
    tenant: { id: slug, ...(tenantDoc as TenantDoc) },
  };
}

/**
 * Generate a one-time magic link the tenant owner can click to sign in.
 * Lands on /api/auth/callback which mints a session cookie + redirects to /owner.
 */
export async function generateTenantOwnerSignInLink(
  ownerEmail: string,
  baseUrl: string,
): Promise<string> {
  initFirebaseAdmin();
  return await getAuth().generateSignInWithEmailLink(ownerEmail, {
    url: `${baseUrl}/api/auth/callback?email=${encodeURIComponent(ownerEmail)}`,
    handleCodeInApp: true,
  });
}
