"use client";

import IdleTimer from "@/components/IdleTimer";

/**
 * Admin-shell mount of the shared IdleTimer. Posts to the admin sign-out
 * endpoint (which revokes refresh tokens) and redirects to /admin/login.
 * Kept as a thin wrapper so existing imports stay stable.
 */
export default function AdminIdleTimer() {
  return (
    <IdleTimer
      signOutEndpoint="/api/admin/auth/sign-out"
      redirectTo="/admin/login?reason=idle_timeout"
    />
  );
}
