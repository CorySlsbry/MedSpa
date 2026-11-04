"use client";

import { useState } from "react";

type Status =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "ok" }
  | { phase: "error"; message: string };

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<Status>({ phase: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status.phase === "submitting") return;
    setStatus({ phase: "submitting" });
    try {
      const res = await fetch("/api/marketing/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company: company || null, message, website }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({
          phase: "error",
          message: body?.error ?? "Couldn't send your message. Try again.",
        });
        return;
      }
      setStatus({ phase: "ok" });
    } catch (err) {
      setStatus({
        phase: "error",
        message:
          err instanceof Error ? err.message : "Couldn't reach the server.",
      });
    }
  }

  if (status.phase === "ok") {
    return (
      <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
        <strong className="block font-semibold">Thanks — we got it.</strong>
        We&apos;ll write back to <strong>{email}</strong>. Usually same-day,
        always within one business day.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Honeypot — hidden from humans, harvested by bots */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      <Field label="Your name" required>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={160}
          className="w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm focus:border-[var(--color-teal)] focus:outline-none"
        />
      </Field>

      <Field label="Your email" required>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          maxLength={320}
          className="w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm focus:border-[var(--color-teal)] focus:outline-none"
        />
      </Field>

      <Field label="Clinic / company" hint="Optional — but it helps us route faster">
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          autoComplete="organization"
          maxLength={200}
          className="w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm focus:border-[var(--color-teal)] focus:outline-none"
        />
      </Field>

      <Field label="What's on your mind?" required>
        <textarea
          required
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={5000}
          className="w-full resize-y rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm focus:border-[var(--color-teal)] focus:outline-none"
          placeholder="Pricing question, demo request, technical issue — just type."
        />
      </Field>

      {status.phase === "error" && (
        <div className="rounded-lg border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {status.message}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--color-ink-muted)]">
          We&apos;ll only use this to reply. No marketing list, no list-share,
          no auto-enroll.
        </p>
        <button
          type="submit"
          disabled={status.phase === "submitting" || !name || !email || message.length < 5}
          className="btn btn-gold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status.phase === "submitting" ? "Sending…" : "Send message"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
        {required && <span className="ml-1 text-[var(--color-gold-deep)]">*</span>}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-[var(--color-ink-muted)]">{hint}</span>}
    </label>
  );
}
