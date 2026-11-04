"use client";

import { useState } from "react";

export default function SmsLineCard({
  initialNumber,
  initialSubaccountSid,
}: {
  initialNumber: string | null;
  initialSubaccountSid: string | null;
}) {
  const [number, setNumber] = useState(initialNumber);
  const [subaccountSid, setSubaccountSid] = useState(initialSubaccountSid);
  const [busy, setBusy] = useState(false);
  const [areaCode, setAreaCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const provisioned = !!number && !!subaccountSid;

  async function provision() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/owner/sms/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area_code: areaCode || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not provision.");
        setBusy(false);
        return;
      }
      setNumber(body.phone_number);
      setSubaccountSid(body.subaccount_sid);
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (provisioned) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-gold)] bg-[var(--color-paper)] p-6 shadow-sm">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            background:
              "radial-gradient(circle at top right, var(--color-gold), transparent 60%)",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
              SMS line
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
              Live
            </span>
          </div>
          <div className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)]">
            {number}
          </div>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            Your dedicated number for confirmations, reminders, and two-way
            client conversations. Provisioned via your Aesthera SMS subaccount.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
                Subaccount
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-[var(--color-ink)]">
                {subaccountSid?.slice(0, 8)}…{subaccountSid?.slice(-6)}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-muted)]">
                Inbound
              </div>
              <div className="mt-0.5 font-semibold text-emerald-700">
                Connected
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        SMS line
      </div>
      <h2 className="mt-1 font-display text-xl font-bold text-[var(--color-navy)]">
        Get your dedicated SMS number
      </h2>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        One click to provision a Twilio number for your clinic — used for
        appointment confirmations, 24-hour reminders, and two-way client
        conversations in your Inbox. Roughly $1.15/month per number, billed
        through your Aesthera plan.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Preferred area code (optional)
          </span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={3}
            placeholder="801"
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))}
            className="mt-1 w-32 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm"
          />
        </label>
        <button
          type="button"
          onClick={provision}
          disabled={busy}
          className="rounded-lg bg-[var(--color-navy)] px-4 py-2 text-sm font-semibold text-[var(--color-cream)] transition hover:bg-[var(--color-navy-deep)] disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Provisioning…" : "Provision SMS line"}
        </button>
      </div>
      {err && (
        <div className="mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {err}
        </div>
      )}
      <p className="mt-3 text-[11px] text-[var(--color-ink-muted)]">
        We&apos;ll create a Twilio subaccount for your clinic, search for an
        available local number (matching your area code if specified), and wire
        the inbound webhook automatically. Takes about 5 seconds.
      </p>
    </div>
  );
}
