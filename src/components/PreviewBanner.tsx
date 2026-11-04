"use client";

import { useState } from "react";

const ROLE_LABEL: Record<string, string> = {
  tenant_owner: "Owner",
  tenant_manager: "Manager",
  tenant_provider: "Provider",
  tenant_front_desk: "Front Desk",
  tenant_client: "Client",
};

/**
 * Sticky banner shown across the top of any tenant shell when the
 * super-admin is previewing as a tenant role. Renders only when isPreview
 * is true, includes role + tenant name + Exit button that POSTs to
 * /api/admin/preview/stop and bounces back to /admin.
 */
export default function PreviewBanner({
  role,
  tenantName,
}: {
  role: string;
  tenantName: string;
}) {
  const [pending, setPending] = useState(false);

  async function exit() {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/admin/preview/stop", { method: "POST" });
    } finally {
      window.location.href = "/admin/preview";
    }
  }

  return (
    <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 bg-[var(--color-gold)] px-4 py-2 text-xs font-semibold text-[var(--color-navy-deep)] shadow">
      <span className="flex items-center gap-2">
        <span aria-hidden="true">👁</span>
        <span>
          Previewing as <strong>{ROLE_LABEL[role] ?? role}</strong> at{" "}
          <strong>{tenantName}</strong> · super-admin session active · idle
          timeout disabled
        </span>
      </span>
      <span className="flex items-center gap-2">
        <a
          href="/admin/preview"
          className="rounded-md border border-[var(--color-navy-deep)] bg-[var(--color-cream)] px-3 py-1 text-[11px] font-bold text-[var(--color-navy-deep)] transition hover:bg-white"
        >
          Switch role
        </a>
        <button
          type="button"
          onClick={exit}
          disabled={pending}
          className="rounded-md border border-[var(--color-navy-deep)] bg-[var(--color-cream)] px-3 py-1 text-[11px] font-bold text-[var(--color-navy-deep)] transition hover:bg-white disabled:opacity-50"
        >
          {pending ? "Exiting…" : "Exit preview"}
        </button>
      </span>
    </div>
  );
}
