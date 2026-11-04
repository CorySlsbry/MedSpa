"use client";

import { useState } from "react";

/**
 * Posts to /api/admin/auth/sign-out which calls
 * `getAuth().revokeRefreshTokens(uid)` — that revocation invalidates ALL
 * active session cookies for this user (the dashboard layout's
 * verifySessionCookie call uses checkRevoked=true). So a single sign-out
 * here terminates every browser/device this account is signed into.
 */
export default function SignOutAllButton() {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    const ok = window.confirm(
      "Sign out of every device and browser where this account is currently signed in? You'll need to sign in again everywhere.",
    );
    if (!ok) return;
    setPending(true);
    try {
      await fetch("/api/admin/auth/sign-out", { method: "POST" });
    } finally {
      window.location.href = "/admin/login?reason=signed_out_all";
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 disabled:opacity-50"
    >
      {pending ? "Signing out…" : "Sign out everywhere"}
    </button>
  );
}
