"use client";

import { useState } from "react";
import { Calendar, Mail, Check, AlertTriangle } from "lucide-react";

export default function GoogleIntegrationCard({
  connected,
  accountEmail,
  accountName,
  scopes,
  connectedAt,
  lastUsedAt,
  lastError,
}: {
  connected: boolean;
  accountEmail: string | null;
  accountName: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
}) {
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    if (!confirm(`Disconnect ${accountEmail || "Google"}? Calendar events will stop being created.`)) return;
    setBusy(true);
    try {
      await fetch("/api/admin/integrations/google/disconnect", { method: "POST" });
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  const hasCalendar = scopes.some((s) => s.includes("calendar"));
  const hasGmail = scopes.some((s) => s.includes("gmail"));

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg font-bold text-[var(--color-navy)]">
            Google · Calendar + Gmail
          </div>
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            Used to write Calendar events when prospects book demos and (future) poll Gmail for inbound
            replies that aren&apos;t routed through Resend Inbound.
          </p>
        </div>
        {connected ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
            Connected
          </span>
        ) : (
          <span className="rounded-full bg-slate-200 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-700">
            Not connected
          </span>
        )}
      </div>

      {connected ? (
        <>
          <div className="mt-4 space-y-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)]/40 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-ink-muted)]">Account</span>
              <span className="font-mono text-[var(--color-navy)]">
                {accountName ? `${accountName} <${accountEmail}>` : accountEmail}
              </span>
            </div>
            {connectedAt && (
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-ink-muted)]">Connected</span>
                <span className="text-[var(--color-navy)]">{connectedAt}</span>
              </div>
            )}
            {lastUsedAt && (
              <div className="flex items-center justify-between">
                <span className="text-[var(--color-ink-muted)]">Last used</span>
                <span className="text-[var(--color-navy)]">{lastUsedAt}</span>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className={`flex items-center gap-1 rounded-full px-2 py-1 ${hasCalendar ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
              <Calendar className="h-3 w-3" strokeWidth={2.5} />
              Calendar {hasCalendar ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
            </span>
            <span className={`flex items-center gap-1 rounded-full px-2 py-1 ${hasGmail ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
              <Mail className="h-3 w-3" strokeWidth={2.5} />
              Gmail (read+modify) {hasGmail ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
            </span>
          </div>

          {lastError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
              <div>
                <div className="font-semibold">Last call failed</div>
                <div>{lastError}</div>
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <a
              href="/api/admin/integrations/google/start"
              className="rounded-md border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] transition hover:bg-[var(--color-cream-deep)]"
            >
              Reconnect (refresh scopes)
            </a>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <a
            href="/api/admin/integrations/google/start"
            className="inline-flex items-center gap-2 rounded-md bg-[var(--color-gold)] px-4 py-2 text-sm font-semibold text-[var(--color-navy-deep)] transition hover:opacity-90"
          >
            Connect Google →
          </a>
          <p className="mt-2 text-[11px] text-[var(--color-ink-muted)]">
            You&apos;ll be redirected to Google to grant Calendar + Gmail permissions for the
            account that runs Aesthera.
          </p>
        </div>
      )}
    </div>
  );
}
