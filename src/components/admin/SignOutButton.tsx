"use client";

import { useState } from "react";

export default function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      await fetch("/api/admin/auth/sign-out", { method: "POST" });
    } catch {
      // ignore — we'll redirect either way
    }
    window.location.href = "/admin/login";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={
        compact
          ? "rounded border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)]"
          : "mt-3 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-cream-deep)] disabled:opacity-60"
      }
    >
      {pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
