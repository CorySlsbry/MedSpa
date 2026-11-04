"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders a QR code that the provider's phone can scan to open
 * /photo-capture/[token]. The token is single-tenant and grants 30 min
 * of token-authenticated photo uploads scoped to the (client,
 * appointment, chart) tuple. Once the provider's done capturing, they
 * can click "End pairing" to revoke the token early.
 */
export default function PhonePairing({
  clientId,
  appointmentId,
  chartId,
}: {
  clientId: string;
  appointmentId: string | null;
  chartId: string | null;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/photos/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          appointment_id: appointmentId,
          chart_id: chartId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Couldn't start pairing.");
        return;
      }
      setToken(body.token);
      setCaptureUrl(body.capture_url);
      setExpiresAt(new Date(body.expires_at));
      const dataUrl = await QRCode.toDataURL(body.capture_url, {
        margin: 2,
        width: 220,
        color: { dark: "#1b2636", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setPending(false);
    }
  }

  async function endPairing() {
    if (!token) return;
    try {
      await fetch(`/api/photos/pair?token=${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
    } catch {
      /* best-effort revoke; the token expires on its own anyway */
    }
    setToken(null);
    setCaptureUrl(null);
    setQrDataUrl(null);
    setExpiresAt(null);
  }

  const remainingMs = expiresAt ? expiresAt.getTime() - now : 0;
  const remainingMin = Math.max(0, Math.floor(remainingMs / 60000));
  const remainingSec = Math.max(0, Math.floor((remainingMs % 60000) / 1000));

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-bold text-[var(--color-navy)]">
            Pair my phone
          </h3>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            Generates a QR code. Scan it with your phone to open a capture page
            tied to THIS chart. Photos appear here as you take them.
          </p>
        </div>
        {token && (
          <button
            type="button"
            onClick={() => void endPairing()}
            className="text-[11px] font-semibold text-rose-700 hover:underline"
          >
            End pairing
          </button>
        )}
      </div>

      {!token && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => void start()}
            disabled={pending}
            className="rounded-md bg-[var(--color-navy)] px-4 py-2 text-sm font-semibold text-[var(--color-cream)] disabled:opacity-50"
          >
            {pending ? "Generating…" : "Start phone pairing"}
          </button>
        </div>
      )}

      {token && qrDataUrl && (
        <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="Phone pairing QR code"
            width={220}
            height={220}
            className="rounded-lg border border-[var(--color-line)]"
          />
          <div className="flex-1">
            <div className="text-xs font-semibold text-[var(--color-navy)]">Scan with your phone camera</div>
            <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
              iOS and Android camera apps detect this QR. The phone opens a
              capture page tied to this chart — every photo you take saves
              automatically and shows up in the gallery below.
            </p>
            <p className="mt-3 text-[11px] text-[var(--color-ink-muted)]">
              Or open this URL on your phone manually:
            </p>
            <code className="mt-1 block break-all rounded bg-[var(--color-cream-deep)] px-2 py-1 font-mono text-[10px] text-[var(--color-ink)]">
              {captureUrl}
            </code>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--color-cream-deep)] px-3 py-1 text-[10px] font-semibold text-[var(--color-ink-soft)]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Pairing active · expires in {remainingMin}m {remainingSec.toString().padStart(2, "0")}s
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          {error}
        </div>
      )}
    </div>
  );
}
