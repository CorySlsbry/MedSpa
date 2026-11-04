/**
 * Tenant context resolution — server-side only.
 *
 * Given a SessionUser, fetches the tenant doc and exposes it together
 * with the user. Used by the (owner|provider|client) layouts to gate
 * access and render tenant-branded chrome.
 */

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getSessionUser, type SessionUser } from "./auth-server";
import { db, toDate } from "./firestore";
import { getTenant } from "./tenant";
import type { TenantDoc, UserDoc } from "./firestore-types";

export const PREVIEW_COOKIE_NAME = "aesthera-view-as";

export type TenantContext = {
  user: SessionUser;
  tenant: TenantDoc & { id: string };
  activePath: string;
  /** True when the current request is a super-admin preview of a tenant
   * role, not a real tenant session. Tenant pages can use this to render
   * a banner + audit trail differently. */
  isPreview: boolean;
};

type PreviewCookieValue = {
  role: SessionUser["role"];
  tenantId: string;
};

function readPreviewCookie(
  cookieJar: Awaited<ReturnType<typeof cookies>>,
): PreviewCookieValue | null {
  const raw = cookieJar.get(PREVIEW_COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PreviewCookieValue;
    if (!parsed.role || !parsed.tenantId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * API-route variant. Returns context or null + an error response for
 * the caller to short-circuit. Doesn't redirect — it's the caller's job
 * to return the NextResponse.
 */
export type ApiContextResult =
  | { ok: true; user: SessionUser; tenant: TenantDoc & { id: string } }
  | { ok: false; status: number; error: string };

export async function requireTenantContextApi(
  requiredRole?: SessionUser["role"],
): Promise<ApiContextResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, status: 401, error: "Not signed in." };
  if (!user.tenantId || user.role === "super_admin") {
    return { ok: false, status: 403, error: "No tenant in scope." };
  }
  if (requiredRole && user.role !== requiredRole) {
    return { ok: false, status: 403, error: "Forbidden." };
  }
  const tenant = await getTenant(user.tenantId);
  if (!tenant) return { ok: false, status: 404, error: "Tenant not found." };
  return { ok: true, user, tenant };
}

/**
 * Resolve the tenant context for the current request. If the user isn't
 * signed in, isn't a tenant user, or their tenant doc is missing, redirect
 * to /sign-in.
 *
 * @param requiredRole — restrict to a specific tenant role. If omitted,
 *   any tenant role passes.
 */
/** Tenant roles that touch PHI and therefore must complete MFA when enrolled.
 * Patients (tenant_client) can stay AAL1 — forcing MFA on a patient portal
 * usability-tanks adoption and isn't a HIPAA requirement. Front-desk staff
 * see scheduling + check-ins which contain PHI; managers see operational
 * + HR data; both get the AAL2 gate. */
const AAL2_REQUIRED_ROLES: ReadonlySet<SessionUser["role"]> = new Set([
  "tenant_owner",
  "tenant_manager",
  "tenant_provider",
  "tenant_front_desk",
]);

/** Allowed even at AAL1 so a user with MFA enrolled but no AAL2 session can
 * recover (e.g. lost device, rotate factor). */
const TENANT_AAL1_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "/owner/security",
  "/manager/security",
  "/provider/security",
  "/front-desk/security",
  "/sign-in",
]);

export async function requireTenantContext(
  requiredRole?: SessionUser["role"],
): Promise<TenantContext> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in?reason=expired");

  // Super-admin "View as" preview path — when the aesthera-view-as cookie
  // is set on a super_admin session, render the tenant shell as if the
  // user held the previewed role for the previewed tenant. The session
  // cookie remains super_admin so audit_log writes still attribute to the
  // real super-admin user — accurate forensics, no impersonation drift.
  if (user.role === "super_admin") {
    const cookieJar = await cookies();
    const preview = readPreviewCookie(cookieJar);
    if (preview) {
      if (requiredRole && preview.role !== requiredRole) {
        // Preview role doesn't match the layout's required role; redirect
        // to the matching layout for the previewed role so the user lands
        // on the right portal automatically.
        const target = ROLE_TO_PORTAL[preview.role] ?? "/admin";
        redirect(target);
      }
      const previewTenant = await getTenant(preview.tenantId);
      if (!previewTenant) redirect("/admin/preview?reason=tenant_missing");

      const h0 = await headers();
      const activePath0 =
        h0.get("x-aesthera-pathname") ?? h0.get("x-invoke-path") ?? "/";
      // Synthesize a SessionUser with the previewed role so downstream
      // code (TenantShell, components reading user.role) behaves as if
      // the previewed role were active.
      const previewUser: SessionUser = {
        ...user,
        role: preview.role,
        tenantId: preview.tenantId,
      };
      return {
        user: previewUser,
        tenant: previewTenant,
        activePath: activePath0,
        isPreview: true,
      };
    }
    // No preview cookie + super_admin trying to hit a tenant route ->
    // bounce to admin (they should have started a preview from /admin/preview).
    redirect("/admin/preview?reason=no_preview");
  }

  if (!user.tenantId) {
    redirect("/sign-in?reason=invalid");
  }
  if (requiredRole && user.role !== requiredRole) {
    redirect("/sign-in?reason=invalid");
  }

  const tenant = await getTenant(user.tenantId);
  if (!tenant) redirect("/sign-in?reason=invalid");

  const h = await headers();
  const activePath =
    h.get("x-aesthera-pathname") ?? h.get("x-invoke-path") ?? "/";

  // AAL2 gate: if the user holds an MFA-required role AND has MFA enrolled
  // in their Firestore record AND the current session is only AAL1, force
  // a re-sign-in. Mirrors the admin layout's enforcement so PHI-touching
  // tenant users get the same protection.
  if (
    AAL2_REQUIRED_ROLES.has(user.role) &&
    !TENANT_AAL1_ALLOWED_PATHS.has(activePath)
  ) {
    try {
      const userDoc = await db().collection("users").doc(user.firebaseUid).get();
      const data = userDoc.data() as UserDoc | undefined;
      const mfaEnrolledAt = toDate(data?.mfa_enrolled_at ?? null);
      if (mfaEnrolledAt && user.aal !== "aal2") {
        redirect("/sign-in?reason=mfa_required");
      }
    } catch (err) {
      // Fail-open on a Firestore blip — initial setup shouldn't lock the
      // user out. The next request will re-evaluate.
      console.error("[tenant-context] mfa state check failed", err);
    }
  }

  return { user, tenant, activePath, isPreview: false };
}

/** Where each tenant role's portal lives. Used by the View-as preview to
 * route super-admins to the right shell when they switch roles. */
const ROLE_TO_PORTAL: Record<string, string> = {
  tenant_owner: "/owner",
  tenant_manager: "/manager",
  tenant_provider: "/provider",
  tenant_front_desk: "/front-desk",
  tenant_client: "/client",
};
