"use client";

import IdleTimer from "@/components/IdleTimer";

/**
 * Tenant-shell mount of the shared IdleTimer. Posts to the tenant sign-out
 * endpoint and redirects to /sign-in. Same 14-min-warn / 1-min-countdown
 * policy as the admin shell — uniform across the platform per HIPAA
 * §164.312(a)(2)(iii).
 *
 * Skipped entirely when the shell is rendered as a super-admin preview.
 * The tenant sign-out endpoint revokes refresh tokens for the underlying
 * Firebase user — which during a preview is the SUPER ADMIN — so an idle
 * fire would silently sign them out of /admin and kill View-as until they
 * sign back in. Admin-side idle enforcement still applies whenever they
 * navigate back to /admin/* (AdminIdleTimer handles that cleanly).
 */
export default function TenantIdleTimer({ isPreview }: { isPreview?: boolean }) {
  if (isPreview) return null;
  return (
    <IdleTimer
      signOutEndpoint="/api/auth/sign-out"
      redirectTo="/sign-in?reason=idle_timeout"
    />
  );
}
