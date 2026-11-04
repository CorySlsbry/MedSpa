/**
 * Server-side auth utilities.
 *
 * - Initializes Firebase Admin SDK (Identity Platform) using application
 *   default credentials.
 * - Verifies session cookies.
 * - Enforces the super-admin allowlist via ADMIN_BOOTSTRAP_EMAIL.
 * - Auto-provisions the user doc on first sign-in for the bootstrap email
 *   AND sets the `role: 'super_admin'` Firebase custom claim.
 *
 * IMPORTANT: never import this module from client components.
 */

import {
  cert,
  getApps,
  initializeApp,
  applicationDefault,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { cookies, headers } from "next/headers";
import { db, now } from "./firestore";
import type { UserDoc } from "./firestore-types";

const SESSION_COOKIE_NAME = "__aesthera_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 5; // 5 days

/**
 * Public base URL for building redirect URLs from inside an API route.
 *
 * Cloud Run sets req.url's host to the container's internal listen address
 * (e.g. http://0.0.0.0:8080), so `new URL("/path", req.url)` produces a
 * Location header the browser cannot resolve. We need the *public*
 * scheme+host the user is currently on.
 *
 * Resolution order:
 *   1. x-forwarded-host + x-forwarded-proto (set by Cloud Run's load balancer)
 *   2. NEXT_PUBLIC_SITE_URL env var (fallback)
 *   3. req.url's origin (last resort — broken on Cloud Run, OK locally)
 */
export function publicBaseUrl(req: Request): string {
  const xfHost = req.headers.get("x-forwarded-host");
  if (xfHost) {
    const xfProto = req.headers.get("x-forwarded-proto") || "https";
    return `${xfProto}://${xfHost}`;
  }
  const host = req.headers.get("host");
  if (host && !host.startsWith("0.0.0.0") && !host.startsWith("127.0.0.1") && !host.startsWith("localhost")) {
    const proto = req.headers.get("x-forwarded-proto") || "https";
    return `${proto}://${host}`;
  }
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  return new URL(req.url).origin;
}

let initialized = false;

function init() {
  if (initialized) return;
  if (getApps().length > 0) {
    initialized = true;
    return;
  }
  const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saB64) {
    try {
      const parsed = JSON.parse(Buffer.from(saB64, "base64").toString("utf8"));
      initializeApp({ credential: cert(parsed) });
    } catch (err) {
      console.error("[auth] failed to parse FIREBASE_SERVICE_ACCOUNT_JSON", err);
      initializeApp({ credential: applicationDefault() });
    }
  } else {
    initializeApp({ credential: applicationDefault() });
  }
  initialized = true;
}

import type { UserRole } from "./firestore-types";

export type SessionUser = {
  firebaseUid: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  role: UserRole;
  /**
   * The tenant the user is scoped to. null for super_admin (no tenant)
   * or for users without role/claim set.
   */
  tenantId: string | null;
  isBootstrapAdmin: boolean;
  /**
   * Authenticator Assurance Level. "aal2" means MFA was completed in this
   * session. "aal1" means only the primary factor (password / magic link).
   * Derived from the firebase.sign_in_second_factor claim.
   */
  aal: "aal1" | "aal2";
};

/**
 * Verify the session cookie on the current request and return the
 * authenticated user. Returns null if no/invalid session or not super-admin.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  init();
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    // checkRevoked=true forces a check against Firebase's revoked-token list.
    const decoded = await getAuth().verifySessionCookie(sessionCookie, true);
    const email = (decoded.email || "").toLowerCase();
    const isBootstrap = isBootstrapAdminEmail(email);
    const claimRole = (decoded as { role?: string }).role;
    const tenantId = ((decoded as { tenant_id?: string }).tenant_id) || null;

    // Resolve role:
    //   1. Bootstrap email always wins → super_admin
    //   2. Otherwise use the role custom claim
    //   3. If no recognized role → fail closed
    let role: UserRole | null = null;
    if (isBootstrap) {
      role = "super_admin";
    } else if (
      claimRole === "super_admin" ||
      claimRole === "tenant_owner" ||
      claimRole === "tenant_manager" ||
      claimRole === "tenant_provider" ||
      claimRole === "tenant_front_desk" ||
      claimRole === "tenant_client"
    ) {
      role = claimRole;
    }
    if (!role) return null;

    // Tenant-roled users MUST have a tenant_id claim
    if (role !== "super_admin" && !tenantId) return null;

    const fb = (decoded as unknown as {
      firebase?: { sign_in_second_factor?: string };
    }).firebase;
    const aal: "aal1" | "aal2" = fb?.sign_in_second_factor ? "aal2" : "aal1";

    return {
      firebaseUid: decoded.uid,
      email,
      emailVerified: !!decoded.email_verified,
      displayName: (decoded.name as string) || null,
      role,
      tenantId,
      isBootstrapAdmin: isBootstrap,
      aal,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] session verify failed", (err as Error).message);
    }
    return null;
  }
}

export function isBootstrapAdminEmail(email: string): boolean {
  const raw = (process.env.ADMIN_BOOTSTRAP_EMAIL || "").toLowerCase();
  if (!raw || !email) return false;
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export async function createSessionCookie(idToken: string): Promise<{
  value: string;
  maxAgeSeconds: number;
}> {
  init();
  const expiresIn = SESSION_COOKIE_MAX_AGE_SECONDS * 1000;
  const value = await getAuth().createSessionCookie(idToken, { expiresIn });
  return { value, maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS };
}

export { SESSION_COOKIE_NAME };

/**
 * Ensure a Firestore `users/{uid}` doc exists for this Firebase user, AND
 * set the `role: 'super_admin'` custom claim on their Firebase account so
 * future ID tokens carry it (used by middleware + security rules).
 *
 * Idempotent. Safe to call on every sign-in.
 */
export async function ensureUserRecord(
  user: Omit<SessionUser, "aal" | "tenantId"> & {
    aal?: SessionUser["aal"];
    tenantId?: string | null;
  },
): Promise<void> {
  init();
  const ref = db().collection("users").doc(user.firebaseUid);
  const snap = await ref.get();

  if (snap.exists) {
    await ref.update({
      last_seen_at: now(),
      updated_at: now(),
    });
    return;
  }

  // Auto-provision in two cases:
  //   1. Bootstrap admin (Cory's first sign-in)
  //   2. Tenant-roled user (clinic owner/provider/client signing in for the
  //      first time after super-admin provisioned them)
  const isTenantUser =
    user.role === "tenant_owner" ||
    user.role === "tenant_manager" ||
    user.role === "tenant_provider" ||
    user.role === "tenant_front_desk" ||
    user.role === "tenant_client";

  if (!user.isBootstrapAdmin && !isTenantUser) {
    return;
  }

  const doc: Omit<UserDoc, "created_at" | "updated_at" | "last_seen_at"> & {
    created_at: ReturnType<typeof now>;
    updated_at: ReturnType<typeof now>;
    last_seen_at: ReturnType<typeof now>;
  } = {
    email: user.email,
    display_name: user.displayName,
    role: user.role,
    status: "active",
    mfa_required: user.role === "super_admin", // tenants can opt-in later
    mfa_enrolled_at: null,
    last_seen_at: now(),
    created_at: now(),
    updated_at: now(),
  };
  await ref.set(doc);

  // For bootstrap admin, set super_admin claim. Tenant users already have
  // their claims set during tenant provisioning (setTenantClaims).
  if (user.isBootstrapAdmin) {
    try {
      await getAuth().setCustomUserClaims(user.firebaseUid, {
        role: "super_admin",
      });
    } catch (err) {
      console.error("[auth] setCustomUserClaims failed", err);
    }
  }
}

/** Helper for the request IP and user-agent. */
export async function getRequestContext(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : (h.get("x-real-ip") || null);
  const userAgent = h.get("user-agent") || null;
  return { ip, userAgent };
}
