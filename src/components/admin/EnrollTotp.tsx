"use client";

import { useState } from "react";

type Step = "request_password" | "scan_and_verify";

export default function EnrollTotp() {
  const [step, setStep] = useState<Step>("request_password");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<string | null>(null);
  const [sharedSecret, setSharedSecret] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);

  async function startEnrollment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") || "");
    if (!password) {
      setErrorMsg("Password is required to enroll a new factor.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/admin/auth/mfa-enroll-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Could not start enrollment.");
        setSubmitting(false);
        return;
      }
      setEnrollmentToken(body.enrollmentToken);
      setSessionInfo(body.sessionInfo);
      setSharedSecret(body.sharedSecretKey);
      setQrSvg(body.qrSvg);
      setStep("scan_and_verify");
      setSubmitting(false);
    } catch {
      setErrorMsg("Network error. Try again.");
      setSubmitting(false);
    }
  }

  async function finalizeEnrollment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!enrollmentToken || !sessionInfo) {
      setErrorMsg("Session expired. Restart enrollment.");
      setStep("request_password");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    const code = String(fd.get("code") || "").replace(/\D/g, "");
    if (code.length !== 6) {
      setErrorMsg("Enter the 6-digit code from your app.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/admin/auth/mfa-enroll-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentToken,
          sessionInfo,
          verificationCode: code,
          displayName: "Authenticator",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok) {
        window.location.href = body.redirect || "/admin/security?enrolled=1";
        return;
      }
      setErrorMsg(body?.error || "Code didn't match. Codes refresh every 30s.");
      setSubmitting(false);
    } catch {
      setErrorMsg("Network error. Try again.");
      setSubmitting(false);
    }
  }

  if (step === "request_password") {
    return (
      <form onSubmit={startEnrollment} className="mt-5 space-y-4">
        <p className="text-sm text-[var(--color-ink-soft)]">
          To enroll a new authenticator, confirm your password. This is a sensitive
          security action.
        </p>
        <label className="block">
          <span className="block text-sm font-semibold text-[var(--color-navy)]">
            Password
          </span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          />
        </label>
        {errorMsg && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errorMsg}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-gold disabled:cursor-wait disabled:opacity-70"
        >
          {submitting ? "Starting..." : "Continue"}
        </button>
      </form>
    );
  }

  return (
    <div className="mt-5 grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="font-display text-base font-bold text-[var(--color-navy)]">
          Step 1 — Scan with your authenticator
        </h3>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          Open Google Authenticator, 1Password, Authy, or your password
          manager. Add a new TOTP entry by scanning this QR code.
        </p>
        <div
          className="mt-4 inline-block rounded-xl border border-[var(--color-line)] bg-[var(--color-cream-deep)] p-4"
          dangerouslySetInnerHTML={{ __html: qrSvg ?? "" }}
        />
        <details className="mt-3 text-xs text-[var(--color-ink-muted)]">
          <summary className="cursor-pointer font-semibold text-[var(--color-teal)]">
            Can&apos;t scan? Type the secret manually
          </summary>
          <code className="mt-2 block break-all rounded bg-[var(--color-cream-deep)] px-3 py-2 font-mono text-[var(--color-ink)]">
            {sharedSecret}
          </code>
        </details>
      </div>

      <div>
        <h3 className="font-display text-base font-bold text-[var(--color-navy)]">
          Step 2 — Enter the 6-digit code
        </h3>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          The app will display a 6-digit code that refreshes every 30 seconds.
          Enter it below to confirm the link.
        </p>
        <form onSubmit={finalizeEnrollment} className="mt-4 space-y-4">
          <label className="block">
            <span className="block text-sm font-semibold text-[var(--color-navy)]">
              Verification code
            </span>
            <input
              type="text"
              name="code"
              required
              autoFocus
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="123456"
              className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-center font-mono text-lg tracking-[0.4em] shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            />
          </label>
          {errorMsg && (
            <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
              {errorMsg}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-gold w-full justify-center disabled:cursor-wait disabled:opacity-70"
          >
            {submitting ? "Verifying..." : "Confirm and enable"}
          </button>
        </form>
      </div>
    </div>
  );
}
