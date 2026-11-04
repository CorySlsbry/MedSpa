"use client";

import { useCallback, useEffect, useState } from "react";

type ConnectionStatus = "connected" | "expired" | "revoked" | "error";

type Connection = {
  platform: string;
  display: { name: string; description: string; icon: string; brandColor: string };
  configured: boolean;
  setup_hint: string;
  connection: {
    status: ConnectionStatus;
    account_handle: string | null;
    account_display_name: string | null;
    scopes: string[];
    connected_by_email: string | null;
    last_used_at: string | null;
    last_error: string | null;
    updated_at: string | null;
  } | null;
};

export default function IntegrationsView() {
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/owner/social/connections");
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || "Could not load integrations.");
      } else {
        setRows(body.connections);
      }
    } catch {
      setError("Network error.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Listen for OAuth popup completion
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; success?: boolean; platform?: string; error?: string };
      if (!data || data.type !== "aesthera-oauth") return;
      setBusyPlatform(null);
      if (data.success) {
        setToast(`Connected ${data.platform?.replace(/_/g, " ") ?? "platform"}.`);
        void load();
      } else {
        setToast(`Connection failed: ${data.error ?? "unknown error"}`);
      }
      setTimeout(() => setToast(null), 4000);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [load]);

  function openOAuthPopup(platform: string) {
    setBusyPlatform(platform);
    const w = 600;
    const h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const url = `/api/oauth/${platform}/start`;
    const popup = window.open(
      url,
      "aesthera-oauth",
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no`,
    );
    if (!popup) {
      window.location.href = url;
    }
  }

  async function disconnect(platform: string) {
    if (!confirm(`Disconnect ${platform.replace(/_/g, " ")}?`)) return;
    setBusyPlatform(platform);
    try {
      await fetch(`/api/owner/social/connections/${platform}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyPlatform(null);
    }
  }

  if (!rows) {
    return (
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 text-center text-sm text-[var(--color-ink-muted)]">
        {error ?? "Loading integrations…"}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
      <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
        Marketing channel integrations
      </h2>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        Connect each channel via OAuth so the marketing engine can publish on
        your behalf. Tokens are encrypted at rest with AES-256-GCM and never
        leave the server.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}
      {toast && (
        <div className="mt-3 rounded-lg border-l-4 border-emerald-600 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          {toast}
        </div>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <div
            key={r.platform}
            className="rounded-lg border border-[var(--color-line)] bg-white p-4"
          >
            <div className="flex items-start gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: r.display.brandColor }}
              >
                {r.display.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-[var(--color-navy)]">{r.display.name}</h3>
                  <StatusPill status={r.connection?.status ?? null} configured={r.configured} />
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{r.display.description}</p>

                {r.connection && r.connection.status === "connected" && (
                  <div className="mt-3 rounded-md bg-[var(--color-cream)] px-3 py-2 text-xs">
                    <div className="font-semibold text-[var(--color-navy)]">
                      {r.connection.account_display_name || r.connection.account_handle || "Connected"}
                    </div>
                    {r.connection.account_handle && r.connection.account_display_name && (
                      <div className="text-[var(--color-ink-muted)]">
                        {r.connection.account_handle}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] text-[var(--color-ink-muted)]">
                      Connected by {r.connection.connected_by_email ?? "owner"}
                      {r.connection.updated_at &&
                        ` · ${new Date(r.connection.updated_at).toLocaleDateString()}`}
                    </div>
                  </div>
                )}

                {!r.configured && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                      Setup needed
                    </summary>
                    <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">{r.setup_hint}</p>
                  </details>
                )}

                <div className="mt-3 flex items-center gap-2">
                  {r.connection && r.connection.status === "connected" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => openOAuthPopup(r.platform)}
                        disabled={busyPlatform === r.platform}
                        className="text-xs font-semibold text-[var(--color-teal)] hover:underline disabled:opacity-50"
                      >
                        {busyPlatform === r.platform ? "Reconnecting…" : "Reconnect"}
                      </button>
                      <button
                        type="button"
                        onClick={() => disconnect(r.platform)}
                        disabled={busyPlatform === r.platform}
                        className="text-xs font-semibold text-rose-700 hover:underline disabled:opacity-50"
                      >
                        Disconnect
                      </button>
                    </>
                  ) : r.configured ? (
                    <button
                      type="button"
                      onClick={() => openOAuthPopup(r.platform)}
                      disabled={busyPlatform === r.platform}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                      style={{ backgroundColor: r.display.brandColor }}
                    >
                      {busyPlatform === r.platform ? "Connecting…" : "Connect →"}
                    </button>
                  ) : (
                    <span className="text-[11px] text-[var(--color-ink-muted)]">
                      Awaiting platform credentials
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({
  status,
  configured,
}: {
  status: ConnectionStatus | null;
  configured: boolean;
}) {
  if (!configured) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
        Setup
      </span>
    );
  }
  if (!status || status === "revoked") {
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-700">
        Not connected
      </span>
    );
  }
  if (status === "connected") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
        Connected
      </span>
    );
  }
  return (
    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-800">
      {status}
    </span>
  );
}
