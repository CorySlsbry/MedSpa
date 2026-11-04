"use client";

import { useState } from "react";

type Mode = "password" | "magic_link";

export default function TenantSignInForm() {
  const [mode, setMode] = useState<Mode>("password");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "").trim().toLowerCase();
    const password = String(fd.get("password") || "");

    if (!email) {
      setErrorMsg("Email is required.");
      setSubmitting(false);
      return;
    }

    try {
      if (mode === "password") {
        if (!password) {
          setErrorMsg("Password is required.");
          setSubmitting(false);
          return;
        }
        const res = await fetch("/api/auth/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.ok) {
          window.location.href = body.redirect || "/";
          return;
        }
        if (res.status === 423) {
          setErrorMsg(body?.error || "Account locked.");
        } else if (res.status === 429) {
          setErrorMsg(body?.error || "Too many attempts. Try again later.");
        } else {
          setErrorMsg(body?.error || "Email or password is incorrect.");
        }
        setSubmitting(false);
      } else {
        await fetch("/api/auth/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        window.location.href = "/sign-in?sent=1";
      }
    } catch {
      setErrorMsg("Network error. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5">
      <label className="block">
        <span className="block text-sm font-semibold text-[var(--color-navy)]">
          Email
        </span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="person1@example.com"
          className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
        />
      </label>

      {mode === "password" && (
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
        {mode === "password"
          ? "Email me a sign-in link instead"
          : "Use my password instead"}
      </button>

      <p className="text-center text-xs text-[var(--color-ink-muted)]">
        New here? Your clinic admin will send you an invite.
      </p>
    </form>
  );
}
