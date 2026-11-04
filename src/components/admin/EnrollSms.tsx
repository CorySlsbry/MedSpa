"use client";

import { useEffect, useRef, useState } from "react";

type Step = "request_password" | "request_phone" | "verify_code" | "done";

export default function EnrollSms({ email }: { email: string }) {
  const [step, setStep] = useState<Step>("request_password");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const passwordRef = useRef<string>("");
  const phoneRef = useRef<string>("");
  const verificationIdRef = useRef<string | null>(null);
  const recaptchaContainerId = "aesthera-sms-recaptcha";

  // Tear down recaptcha on unmount
  useEffect(() => {
    return () => {
      const el = document.getElementById(recaptchaContainerId);
      if (el) el.innerHTML = "";
    };
  }, []);

  async function startWithPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    passwordRef.current = String(fd.get("password") || "");
    if (!passwordRef.current) {
      setErrorMsg("Password is required.");
      setSubmitting(false);
      return;
    }
    setStep("request_phone");
    setSubmitting(false);
  }

  async function sendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    const phone = String(fd.get("phone") || "").trim();
    if (!/^\+\d{10,15}$/.test(phone)) {
      setErrorMsg("Use full international format, e.g. +18012450511");
      setSubmitting(false);
      return;
    }
    phoneRef.current = phone;

    try {
      const { getClientAuth } = await import("@/lib/firebase-client");
      const {
        signInWithEmailAndPassword,
        multiFactor,
        PhoneAuthProvider,
        RecaptchaVerifier,
      } = await import("firebase/auth");

      const auth = getClientAuth();
      // Re-auth client-side to obtain a "current user" the SDK can act on
      await signInWithEmailAndPassword(auth, email, passwordRef.current);
      if (!auth.currentUser) throw new Error("No current user after sign-in.");

      const mfaSession = await multiFactor(auth.currentUser).getSession();

      const verifier = new RecaptchaVerifier(auth, recaptchaContainerId, {
        size: "invisible",
      });
      const provider = new PhoneAuthProvider(auth);
      const verificationId = await provider.verifyPhoneNumber(
        { phoneNumber: phone, session: mfaSession },
        verifier,
      );
      verificationIdRef.current = verificationId;
      setStep("verify_code");
      setSubmitting(false);
    } catch (err) {
      const msg = (err as { message?: string }).message || "Could not send code.";
      console.error("[enroll-sms] sendCode error", err);
      setErrorMsg(msg);
      setSubmitting(false);
      passwordRef.current = ""; // clear on error
    }
  }

  async function verifyAndEnroll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    const code = String(fd.get("code") || "").replace(/\D/g, "");
    if (code.length !== 6) {
      setErrorMsg("Enter the 6-digit code from your text.");
      setSubmitting(false);
      return;
    }
    if (!verificationIdRef.current) {
      setErrorMsg("Session lost. Restart enrollment.");
      setStep("request_password");
      setSubmitting(false);
      return;
    }

    try {
      const { getClientAuth } = await import("@/lib/firebase-client");
      const {
        PhoneAuthProvider,
        PhoneMultiFactorGenerator,
        multiFactor,
      } = await import("firebase/auth");

      const auth = getClientAuth();
      if (!auth.currentUser) throw new Error("Not signed in.");

      const cred = PhoneAuthProvider.credential(verificationIdRef.current, code);
      const assertion = PhoneMultiFactorGenerator.assertion(cred);
      await multiFactor(auth.currentUser).enroll(assertion, "Personal phone");

      // After enrollment the user's tokens are AAL2. Mint a fresh server cookie.
      const idToken = await auth.currentUser.getIdToken(true);
      const res = await fetch("/api/admin/auth/mfa-session-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, next: "/admin/security?enrolled=sms" }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok) {
        window.location.href = body.redirect || "/admin/security?enrolled=sms";
        return;
      }
      setErrorMsg(body?.error || "Enrollment succeeded but session refresh failed. Sign out and back in.");
      setSubmitting(false);
    } catch (err) {
      const msg = (err as { message?: string }).message || "Code didn't match.";
      console.error("[enroll-sms] verify error", err);
      setErrorMsg(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-5">
      {step === "request_password" && (
        <form onSubmit={startWithPassword} className="space-y-4">
          <p className="text-sm text-[var(--color-ink-soft)]">
            Confirm your password to enroll a phone number for SMS-based 2FA.
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
            {submitting ? "Checking..." : "Continue"}
          </button>
        </form>
      )}

      {step === "request_phone" && (
        <form onSubmit={sendCode} className="space-y-4">
          <p className="text-sm text-[var(--color-ink-soft)]">
            Enter your phone number in international format (start with{" "}
            <code className="font-mono">+1</code> for US/Canada). We&apos;ll text
            a 6-digit verification code.
          </p>
          <label className="block">
            <span className="block text-sm font-semibold text-[var(--color-navy)]">
              Phone number
            </span>
            <input
              type="tel"
              name="phone"
              required
              autoFocus
              autoComplete="tel"
              placeholder="+18012450511"
              className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 font-mono text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            />
          </label>
          <div id={recaptchaContainerId} aria-hidden="true" />
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
            {submitting ? "Sending..." : "Text me a code"}
          </button>
        </form>
      )}

      {step === "verify_code" && (
        <form onSubmit={verifyAndEnroll} className="space-y-4">
          <p className="text-sm text-[var(--color-ink-soft)]">
            We sent a 6-digit code to <strong>{phoneRef.current}</strong>. Enter it below.
          </p>
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
      )}
    </div>
  );
}
