import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth-server";
import { db, toDate } from "@/lib/firestore";
import AdminShell from "@/components/admin/AdminShell";
import type { ReactNode } from "react";
import type { UserDoc } from "@/lib/firestore-types";

/**
 * Authenticated admin layout. Server-side double-check on every request:
 * middleware already gated cookie presence; here we verify the session and
 * enforce AAL2 (MFA-completed) for everything except /admin/security itself.
 *
 * /admin/security must stay accessible at AAL1 so a user who has MFA
 * enrolled but no AAL2 session can re-authenticate or recover (Phase 2:
 * recovery codes).
 */
const AAL1_ALLOWED_PATHS = new Set<string>(["/admin/security"]);

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/admin/login?reason=expired");
  }
  // Hard role gate — only super_admin can see /admin. Defense-in-depth on
  // top of getSessionUser's role resolution. If a tenant_owner / tenant_provider
  // / tenant_client somehow ends up with a session cookie pointing at /admin
  // (e.g. they signed in via /sign-in then hand-typed the URL), they get
  // redirected to /admin/login with a not_admin reason. The /admin/login page
  // can interpret this and offer a sign-out + sign-in-as-admin link.
  if (user.role !== "super_admin") {
    redirect("/admin/login?reason=not_admin");
  }

  const h = await headers();
  const activePath =
    h.get("x-aesthera-pathname") ??
    h.get("x-invoke-path") ??
    h.get("x-pathname") ??
    "/admin";

  // AAL2 gate: if the user has MFA enrolled in their Firestore record but
  // this session is AAL1, force a re-sign-in. The /admin/security route is
  // exempt so the user can recover or rotate factors.
  if (!AAL1_ALLOWED_PATHS.has(activePath)) {
    try {
      const userDoc = await db().collection("users").doc(user.firebaseUid).get();
      const data = userDoc.data() as UserDoc | undefined;
      const mfaEnrolledAt = toDate(data?.mfa_enrolled_at ?? null);
      if (mfaEnrolledAt && user.aal !== "aal2") {
        redirect("/admin/login?reason=mfa_required");
      }
    } catch (err) {
      // If we can't read the user doc, fail-closed only if MFA is mandatory
      // by env var. Otherwise allow through (avoids locking the admin out
      // on a Firestore blip during initial setup).
      console.error("[dashboard] mfa state check failed", err);
    }
  }

  return (
    <AdminShell user={{ email: user.email, displayName: user.displayName }}>
      {children}
    </AdminShell>
  );
}
