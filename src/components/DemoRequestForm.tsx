"use client";

import { useState } from "react";

type FormState = "idle" | "submitting" | "success" | "error";

/**
 * The form below the marketing fold. Captures contacts who want MORE
 * INFO (not a demo call — for calls, the BookingModal takes over). The
 * server-side route enrolls them into the "Aesthera Inbound Nurture"
 * workflow which drips a sequence highlighting how one platform
 * consolidates the seven a clinic typically pays for today.
 */
export default function DemoRequestForm() {
  const [state, setState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("submitting");
    setErrorMsg(null);

    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      clinic_name: String(fd.get("clinic_name") || "").trim(),
      locations: String(fd.get("locations") || "1"),
      role: String(fd.get("role") || "owner"),
      interest: "info",
      notes: String(fd.get("notes") || "").trim(),
    };

    if (!payload.name || !payload.email || !payload.clinic_name) {
      setErrorMsg("Name, email, and clinic name are required.");
      setState("error");
      return;
    }

    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || "Something went wrong. Try again or email person1@example.com.");
      }
      setState("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Submission failed.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <SuccessShell
        headline="On its way."
        body="The first email — how seven tools become one workspace — just landed in your inbox. Two more follow over the next few days. Reply to any of them with questions, or book a 15-min call any time."
        footer="Don't see it? Check spam. Or text 801-245-0511."
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Your name" name="name" required autoComplete="name" />
        <Field label="Email" name="email" type="email" required autoComplete="email" />
        <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
        <Field label="Clinic name" name="clinic_name" required autoComplete="organization" />
        <Select label="Locations" name="locations" defaultValue="1">
          <option value="1">1 location</option>
          <option value="2-3">2–3 locations</option>
          <option value="4-9">4–9 locations</option>
          <option value="10+">10+ locations</option>
        </Select>
        <Select label="Your role" name="role" defaultValue="owner">
          <option value="owner">Owner / Founder</option>
          <option value="medical_director">Medical Director</option>
          <option value="manager">Manager / Operations</option>
          <option value="provider">Provider / Injector</option>
          <option value="other">Other</option>
        </Select>
      </div>

      <div>
        <label className="block text-sm font-semibold text-[var(--color-navy)]">
          What&apos;s the biggest pain right now? <span className="font-normal text-[var(--color-ink-muted)]">(optional)</span>
        </label>
        <textarea
          name="notes"
          rows={3}
          className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
          placeholder="e.g. front desk types the same client into 4 systems, no roll-up across locations, AI marketing is a black box…"
        />
      </div>

      {state === "error" && errorMsg && (
        <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-xs text-[var(--color-ink-muted)]">
          No spam. Three short emails, then we stop. Unsubscribe with one click. By submitting you agree to our <a href="/privacy" className="underline">privacy policy</a>.
        </p>
        <button
          type="submit"
          disabled={state === "submitting"}
          className="btn btn-gold justify-center disabled:cursor-wait disabled:opacity-70"
          data-cta="Info form · Submit"
        >
          {state === "submitting" ? "Sending..." : "Send me the info →"}
        </button>
      </div>
    </form>
  );
}

function SuccessShell({
  headline,
  body,
  footer,
  children,
}: {
  headline: string;
  body: string;
  footer: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-teal)]/10 text-[var(--color-teal)]">
          <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
        </div>
        <h3 className="mt-5 font-display text-2xl font-bold text-[var(--color-navy)]">{headline}</h3>
        <p className="mt-3 text-[var(--color-ink-soft)]">{body}</p>
      </div>
      {children}
      <p className="mt-6 text-center text-sm text-[var(--color-ink-muted)]">{footer}</p>
    </div>
  );
}

function Field({ label, name, type = "text", required, autoComplete }: { label: string; name: string; type?: string; required?: boolean; autoComplete?: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-[var(--color-navy)]">
        {label} {required && <span className="text-[var(--color-gold)]">*</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      />
    </label>
  );
}

function Select({ label, name, defaultValue, children }: { label: string; name: string; defaultValue?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-[var(--color-navy)]">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-4 py-3 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      >
        {children}
      </select>
    </label>
  );
}
