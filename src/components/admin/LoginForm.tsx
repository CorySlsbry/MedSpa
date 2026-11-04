"use client";

import { useState, useRef } from "react";

type Mode = "password" | "magic_link";
type Step =
  | "credentials"
  | "choose_factor"
  | "totp_code"
  | "sms_sending"
  | "sms_code"
  | "recovery_code";

type FactorHint = {
  factorId: "totp" | "phone";
  enrollmentId: string;
  displayName?: string;
  phoneNumber?: string;
};

export default function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>("password");
  const [step, setStep] = useState<Step>("credentials");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // captured during credentials step
  const credEmailRef = useRef<string>("");
  const credPasswordRef = useRef<string>("");

  // captured from server password response (server-side TOTP path)
  const [serverMfaPending, setServerMfaPending] = useState<{
    pendingCredential: string;
    factors: FactorHint[];
  } | null>(null);

  // captured during client SDK SMS flow
  const smsVerificationIdRef = useRef<string | null>(null);
  const [chosenFactor, setChosenFactor] = useState<FactorHint | null>(null);

  function reset() {
    setStep("credentials");
    setErrorMsg(null);
    setServerMfaPending(null);
    setChosenFactor(null);
    smsVerificationIdRef.current = null;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);

    try {
      // ── Recovery code branch ──
      if (step === "recovery_code") {
        const code = String(fd.get("code") || "").trim();
        const res = await fetch("/api/admin/auth/recovery-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: credEmailRef.current,
            password: credPasswordRef.current,
            recoveryCode: code,
            next,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.ok) {
          window.location.href = body.redirect || next || "/admin";
          return;
        }
        setErrorMsg(body?.error || "Recovery code is invalid or already used.");
        setSubmitting(false);
        return;
      }

      // ── TOTP server-side challenge ──
      if (step === "totp_code" && serverMfaPending && chosenFactor) {
        const code = String(fd.get("code") || "").replace(/\D/g, "");
        if (code.length !== 6) {
          setErrorMsg("Enter the 6-digit code from your authenticator.");
          setSubmitting(false);
          return;
        }
        const res = await fetch("/api/admin/auth/mfa-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: credEmailRef.current,
            mfaPendingCredential: serverMfaPending.pendingCredential,
            mfaEnrollmentId: chosenFactor.enrollmentId,
            verificationCode: code,
            next,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.ok) {
          window.location.href = body.redirect || next || "/admin";
          return;
        }
        setErrorMsg(body?.error || "Code didn't match.");
        setSubmitting(false);
        return;
      }

      // ── SMS code submit (client SDK path) ──
      if (step === "sms_code") {
        const code = String(fd.get("code") || "").replace(/\D/g, "");
        if (code.length !== 6) {
          setErrorMsg("Enter the 6-digit code from your text.");
          setSubmitting(false);
          return;
        }
        if (!smsVerificationIdRef.current) {
          setErrorMsg("Session expired. Sign in again.");
          reset();
          return;
        }
        const { getClientAuth } = await import("@/lib/firebase-client");
        const {
          PhoneAuthProvider,
          PhoneMultiFactorGenerator,
          getMultiFactorResolver,
          signInWithEmailAndPassword,
        } = await import("firebase/auth");
        const auth = getClientAuth();
        try {
          // Re-trigger the multi-factor error to get a fresh resolver
          await signInWithEmailAndPassword(auth, credEmailRef.current, credPasswordRef.current);
          // If the above succeeded, MFA is no longer required (race) — bail
          setErrorMsg("Sign-in succeeded without MFA. Refresh to continue.");
          setSubmitting(false);
          return;
        } catch (err) {
          if ((err as { code?: string }).code !== "auth/multi-factor-auth-required") {
            setErrorMsg("Sign-in failed. Try again.");
            setSubmitting(false);
            return;
          }
          const resolver = getMultiFactorResolver(auth, err as Parameters<typeof getMultiFactorResolver>[1]);
          const cred = PhoneAuthProvider.credential(smsVerificationIdRef.current, code);
          const assertion = PhoneMultiFactorGenerator.assertion(cred);
          const userCredential = await resolver.resolveSignIn(assertion);
          const idToken = await userCredential.user.getIdToken();
          const finalize = await fetch("/api/admin/auth/mfa-session-finalize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken, next }),
          });
          const finalBody = await finalize.json().catch(() => ({}));
          if (finalize.ok && finalBody?.ok) {
            window.location.href = finalBody.redirect || next || "/admin";
            return;
          }
          setErrorMsg(finalBody?.error || "Could not establish session.");
          setSubmitting(false);
        }
        return;
      }

      // ── Initial credentials submit ──
      const email = String(fd.get("email") || "").trim().toLowerCase();
      const password = String(fd.get("password") || "");
      if (!email) {
        setErrorMsg("Email is required.");
        setSubmitting(false);
        return;
      }
      credEmailRef.current = email;
      credPasswordRef.current = password;

      if (mode === "password") {
        if (!password) {
          setErrorMsg("Password is required.");
          setSubmitting(false);
          return;
        }
        const res = await fetch("/api/admin/auth/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, next }),
        });
        const body = await res.json().catch(() => ({}));
        if (body?.mfaRequired) {
          // Build factor list — server returns one factor today; we may
          // augment via client SDK if SMS is also enrolled
          const factors: FactorHint[] = [];
          if (body.mfaEnrollmentId) {
            factors.push({
              factorId: "totp",
              enrollmentId: body.mfaEnrollmentId,
              displayName: body.mfaDisplayName,
            });
          }
          // Try to discover all factors via client SDK so SMS becomes available
          const allFactors = await discoverFactorsViaClient(email, password);
          const merged = mergeFactors(factors, allFactors);

          setServerMfaPending({ pendingCredential: body.mfaPendingCredential, factors: merged });
          if (merged.length === 1) {
            setChosenFactor(merged[0]);
            setStep(merged[0].factorId === "totp" ? "totp_code" : "sms_sending");
            if (merged[0].factorId === "phone") {
              await sendSmsChallenge(merged[0]);
            }
          } else {
            setStep("choose_factor");
          }
          setSubmitting(false);
          return;
        }
        if (res.ok && body?.ok) {
          window.location.href = body.redirect || next || "/admin";
          return;
        }
        if (res.status === 423) {
          setErrorMsg(body?.error || "Account locked. Try again later.");
        } else if (res.status === 429) {
          setErrorMsg(body?.error || "Too many attempts. Try again later.");
        } else {
          setErrorMsg(body?.error || "Email or password is incorrect.");
        }
        setSubmitting(false);
      } else {
        // magic link
        const res = await fetch("/api/admin/auth/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, next }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (res.status === 429) {
            setErrorMsg(body?.error || "Too many requests. Try again shortly.");
            setSubmitting(false);
            return;
          }
        }
        window.location.href = `/admin/login?sent=1&next=${encodeURIComponent(next)}`;
      }
    } catch {
      setErrorMsg("Network error. Try again.");
      setSubmitting(false);
    }
  }

  async function discoverFactorsViaClient(
    email: string,
    password: string,
  ): Promise<FactorHint[]> {
    try {
      const { getClientAuth } = await import("@/lib/firebase-client");
      const { signInWithEmailAndPassword, getMultiFactorResolver } =
        await import("firebase/auth");
      const auth = getClientAuth();
      try {
        await signInWithEmailAndPassword(auth, email, password);
        return [];
      } catch (err) {
        if ((err as { code?: string }).code !== "auth/multi-factor-auth-required") return [];
        const resolver = getMultiFactorResolver(
          auth,
          err as Parameters<typeof getMultiFactorResolver>[1],
        );
        return resolver.hints.map((h) => ({
          factorId: h.factorId as "totp" | "phone",
          enrollmentId: h.uid,
          displayName: h.displayName ?? undefined,
          phoneNumber: (h as unknown as { phoneNumber?: string }).phoneNumber,
        }));
      }
    } catch (err) {
      console.error("[login] discoverFactors error", err);
      return [];
    }
  }

  function mergeFactors(server: FactorHint[], client: FactorHint[]): FactorHint[] {
    if (client.length > 0) return client;
    return server;
  }

  async function sendSmsChallenge(factor: FactorHint) {
    setSubmitting(true);
    try {
      const { getClientAuth } = await import("@/lib/firebase-client");
      const {
        signInWithEmailAndPassword,
        getMultiFactorResolver,
        PhoneAuthProvider,
        RecaptchaVerifier,
      } = await import("firebase/auth");
      const auth = getClientAuth();
      try {
        await signInWithEmailAndPassword(auth, credEmailRef.current, credPasswordRef.current);
        setErrorMsg("Sign-in succeeded without MFA. Refresh to continue.");
        setSubmitting(false);
        return;
      } catch (err) {
        if ((err as { code?: string }).code !== "auth/multi-factor-auth-required") {
          setErrorMsg("Could not initiate SMS challenge.");
          setSubmitting(false);
          return;
        }
        const resolver = getMultiFactorResolver(
          auth,
          err as Parameters<typeof getMultiFactorResolver>[1],
        );
        const phoneHint = resolver.hints.find((h) => h.uid === factor.enrollmentId);
        if (!phoneHint) {
          setErrorMsg("Phone factor not found.");
          setSubmitting(false);
          return;
        }
        const verifier = new RecaptchaVerifier(auth, "aesthera-login-recaptcha", {
          size: "invisible",
        });
        const provider = new PhoneAuthProvider(auth);
        const verificationId = await provider.verifyPhoneNumber(
          { multiFactorHint: phoneHint, session: resolver.session },
          verifier,
        );
        smsVerificationIdRef.current = verificationId;
        setStep("sms_code");
        setSubmitting(false);
      }
    } catch (err) {
      console.error("[login] sendSmsChallenge error", err);
      setErrorMsg("Could not send SMS. Try the authenticator app instead.");
      setSubmitting(false);
    }
  }

  // ── Render ──

  if (step === "choose_factor" && serverMfaPending) {
    return (
      <div className="mt-8 space-y-4">
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
          Choose your second factor
        </h2>
        <div className="space-y-2">
          {serverMfaPending.factors.map((f) => (
            <button
              key={f.enrollmentId}
              onClick={async () => {
                setChosenFactor(f);
                if (f.factorId === "totp") {
                  setStep("totp_code");
                } else {
                  setStep("sms_sending");
                  await sendSmsChallenge(f);
                }
              }}
              className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-left text-sm font-semibold text-[var(--color-navy)] hover:bg-[var(--color-cream-deep)]"
            >
              {f.factorId === "totp"
                ? `Authenticator app${f.displayName ? ` (${f.displayName})` : ""}`
                : `Text a code to ${f.phoneNumber || "your phone"}`}
            </button>
          ))}
        </div>
        <button
          onClick={reset}
          className="text-xs font-semibold text-[var(--color-teal)] hover:underline"
        >
          ← Use a different account
        </button>
        <div id="aesthera-login-recaptcha" aria-hidden="true" />
      </div>
    );
  }

  if (step === "totp_code" || step === "recovery_code") {
    const isRecovery = step === "recovery_code";
    return (
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <div className="rounded-lg border-l-4 border-[var(--color-teal)] bg-[var(--color-teal-soft)] px-4 py-3 text-sm text-[var(--color-teal-deep)]">
          {isRecovery ? (
            <>
              <strong className="block font-semibold">Recovery code</strong>
              <span className="mt-1 block">
                Enter one of your one-time backup codes (e.g.,{" "}
                <code className="font-mono">a1b2-c3d4</code>).
              </span>
            </>
          ) : (
            <>
              <strong className="block font-semibold">Authenticator code</strong>
              <span className="mt-1 block">
                Open your authenticator app and enter the current 6-digit code.
              </span>
            </>
          )}
        </div>
        <label className="block">
          <span className="block text-sm font-semibold text-[var(--color-navy)]">
            {isRecovery ? "Recovery code" : "Code"}
          </span>
          <input
            type="text"
            name="code"
            required
            autoFocus
            inputMode={isRecovery ? "text" : "numeric"}
            pattern={isRecovery ? undefined : "[0-9]{6}"}
            maxLength={isRecovery ? 12 : 6}
            autoComplete="one-time-code"
            placeholder={isRecovery ? "a1b2-c3d4" : "123456"}
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
          {submitting ? "Verifying..." : "Verify and sign in"}
        </button>
        <button type="button" onClick={reset} className="block w-full text-center text-xs font-semibold text-[var(--color-teal)] hover:underline">
          ← Cancel
        </button>
      </form>
    );
  }

  if (step === "sms_sending") {
    return (
      <div className="mt-8 space-y-4 text-center">
        <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-[var(--color-gold)]/30" />
        <p className="text-sm text-[var(--color-ink-soft)]">Sending verification code...</p>
        <div id="aesthera-login-recaptcha" aria-hidden="true" />
        {errorMsg && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errorMsg}
          </div>
        )}
        <button onClick={reset} className="text-xs font-semibold text-[var(--color-teal)] hover:underline">
          ← Cancel
        </button>
      </div>
    );
  }

  if (step === "sms_code") {
    return (
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <div className="rounded-lg border-l-4 border-[var(--color-teal)] bg-[var(--color-teal-soft)] px-4 py-3 text-sm text-[var(--color-teal-deep)]">
          <strong className="block font-semibold">Text message sent</strong>
          <span className="mt-1 block">
            We sent a 6-digit code to{" "}
            <strong>{chosenFactor?.phoneNumber || "your phone"}</strong>. It
            should arrive within a few seconds.
          </span>
        </div>
        <label className="block">
          <span className="block text-sm font-semibold text-[var(--color-navy)]">
            Code
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
          {submitting ? "Verifying..." : "Verify and sign in"}
        </button>
        <button type="button" onClick={reset} className="block w-full text-center text-xs font-semibold text-[var(--color-teal)] hover:underline">
          ← Cancel
        </button>
        <div id="aesthera-login-recaptcha" aria-hidden="true" />
      </form>
    );
  }

  // Default: credentials step
  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5">
      <label className="block">
        <span className="block text-sm font-semibold text-[var(--color-navy)]">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
        />
      </label>

      {mode === "password" && (
        <label className="block">
          <span className="block text-sm font-semibold text-[var(--color-navy)]">Password</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          />
        </label>
      )}

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
        {submitting
          ? mode === "password" ? "Signing in..." : "Sending link..."
          : mode === "password" ? "Sign in" : "Email me a sign-in link"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === "password" ? "magic_link" : "password"));
          setErrorMsg(null);
        }}
        className="block w-full text-center text-xs font-semibold text-[var(--color-teal)] hover:underline"
      >
        {mode === "password" ? "Email me a sign-in link instead" : "Use my password instead"}
      </button>

      <p className="text-center text-xs text-[var(--color-ink-muted)]">
        Sign-ins are rate-limited and audited. Two-factor required if enrolled.
      </p>
    </form>
  );
}
