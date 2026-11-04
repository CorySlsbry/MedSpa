"use client";

import { useState } from "react";

export default function CalendarFeedCard({
  icsToken,
  providerName,
}: {
  icsToken: string;
  providerName: string;
}) {
  const [copied, setCopied] = useState(false);
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://aesthera.io";
  const url = `${origin}/api/calendar/${icsToken}.ics`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* user copies manually */
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        Calendar feed
      </div>
      <h2 className="mt-1 font-display text-lg font-bold text-[var(--color-navy)]">
        Subscribe in Google or Apple Calendar
      </h2>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Share this URL with {providerName.split(" ")[0]} to view their schedule
        on their phone. Updates automatically.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={url}
          readOnly
          className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-2 font-mono text-[11px] text-[var(--color-ink)]"
        />
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-[var(--color-navy)] bg-transparent px-3 py-2 text-xs font-semibold text-[var(--color-navy)] hover:bg-[var(--color-cream-deep)]"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <details className="mt-3 text-xs text-[var(--color-ink-soft)]">
        <summary className="cursor-pointer font-semibold">How to subscribe</summary>
        <ul className="ml-5 mt-2 list-disc space-y-1">
          <li>
            <strong>Google Calendar:</strong> Other calendars → + → From URL → paste.
          </li>
          <li>
            <strong>Apple Calendar:</strong> File → New Calendar Subscription → paste.
          </li>
          <li>
            <strong>Outlook:</strong> Add calendar → Subscribe from web → paste.
          </li>
        </ul>
      </details>
      <p className="mt-3 text-[10px] text-[var(--color-ink-muted)]">
        URL is unguessable but unauthenticated — only share with the provider. To
        rotate, deactivate this provider and re-invite.
      </p>
    </div>
  );
}
