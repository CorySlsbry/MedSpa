"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type ConnState = {
  platform: string;
  display: { name: string; icon: string; brandColor: string; description: string };
  configured: boolean;
  setup_hint: string;
  connection: {
    status: string;
    account_handle: string | null;
    account_display_name: string | null;
  } | null;
};

export default function ChannelsCard() {
  const [rows, setRows] = useState<ConnState[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/owner/social/connections");
      const body = await res.json();
      if (res.ok) setRows(body.connections);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Listen for the OAuth popup completing
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; success?: boolean; platform?: string; error?: string };
      if (!data || data.type !== "aesthera-oauth") return;
      setBusy(null);
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
    setBusy(platform);
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
      // Pop-up blocked — fall back to a same-tab redirect
      window.location.href = url;
    }
  }

  if (!rows) return null;

  const connected = rows.filter((r) => r.connection?.status === "connected");
  const total = rows.length;

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
            Marketing channels
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            {connected.length} of {total} connected. Tokens are encrypted at
            rest. Disconnect anytime in{" "}
            <Link href="/owner/settings" className="text-[var(--color-teal)] hover:underline">
              Settings
            </Link>
            .
          </p>
        </div>
      </div>

      {toast && (
        <div className="mt-3 rounded-lg border-l-4 border-emerald-600 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          {toast}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        {rows.map((r) => {
          const isConnected = r.connection?.status === "connected";
          const isBusy = busy === r.platform;
          const clickable = r.configured && !isBusy;
          const handleClick = () => {
            if (!r.configured) return;
            openOAuthPopup(r.platform);
          };
          return (
            <button
              key={r.platform}
              type="button"
              onClick={handleClick}
              disabled={!clickable}
              title={
                !r.configured
                  ? `Setup needed: ${r.setup_hint}`
                  : isConnected
                    ? "Click to reconnect (refresh permissions)"
                    : `Connect ${r.display.name}`
              }
              className={`group flex flex-col items-stretch gap-2 rounded-lg border p-3 text-left transition ${
                isConnected
                  ? "border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50"
                  : r.configured
                    ? "border-[var(--color-line)] bg-white hover:border-[var(--color-gold)] hover:shadow-sm"
                    : "cursor-not-allowed border-dashed border-[var(--color-line)] bg-white/50 opacity-70"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{
                    backgroundColor: r.display.brandColor,
                    opacity: r.configured ? 1 : 0.5,
                  }}
                >
                  {r.display.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-[var(--color-navy)]">
                    {r.display.name.split(" ")[0]}
                  </div>
                  <div className="truncate text-[10px] text-[var(--color-ink-muted)]">
                    {isConnected
                      ? r.connection?.account_handle ||
                        r.connection?.account_display_name ||
                        "Connected"
                      : r.configured
                        ? "Click to connect"
                        : "Setup needed"}
                  </div>
                </div>
              </div>
              <div
                className={`-mb-1 -mx-1 mt-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  isConnected
                    ? "bg-emerald-600 text-white"
                    : r.configured
                      ? "bg-[var(--color-navy)] text-[var(--color-cream)] group-hover:bg-[var(--color-navy-deep)]"
                      : "bg-amber-100 text-amber-800"
                }`}
              >
                {isBusy
                  ? "Connecting…"
                  : isConnected
                    ? "Connected ✓"
                    : r.configured
                      ? "Connect →"
                      : "Setup needed"}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
