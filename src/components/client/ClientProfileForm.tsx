"use client";

import { useState } from "react";
import type { ClientProfile } from "@/app/client/profile/page";

export default function ClientProfileForm({ initial }: { initial: ClientProfile }) {
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    setSaving(true);
    setErr(null);
    const payload = {
      full_name: String(fd.get("full_name") || "").trim(),
      preferred_name: String(fd.get("preferred_name") || "").trim() || null,
      phone: String(fd.get("phone") || "").trim() || null,
      email_consent: fd.get("email_consent") === "on",
      sms_consent: fd.get("sms_consent") === "on",
    };
    try {
      const res = await fetch("/api/client/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Could not save.");
        setSaving(false);
        return;
      }
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2000);
    } catch {
      setErr("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-sm"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Full name" name="full_name" defaultValue={initial.fullName} required />
        <Field
          label="Preferred name (optional)"
          name="preferred_name"
          defaultValue={initial.preferredName ?? ""}
          placeholder="What we call you"
        />
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Email
          </span>
          <input
            type="email"
            value={initial.email}
            disabled
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] px-3 py-2 text-sm text-[var(--color-ink-muted)]"
          />
          <span className="mt-1 block text-[10px] text-[var(--color-ink-muted)]">
            Email is your sign-in. Contact the clinic to change it.
          </span>
        </label>
        <Field
          label="Phone"
          name="phone"
          defaultValue={initial.phone ?? ""}
          placeholder="+1 (555) 123-4567"
        />
      </div>

      <fieldset className="mt-6 rounded-lg border border-[var(--color-line)] p-4">
        <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
          Communication preferences
        </legend>
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="email_consent"
              defaultChecked={initial.emailConsent !== false}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-semibold">Marketing emails</span>
              <span className="ml-1 text-[var(--color-ink-muted)]">
                — promotions, seasonal offers, rebook reminders. Transactional emails (confirmations, receipts) always send.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="sms_consent"
              defaultChecked={initial.smsConsent !== false}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-semibold">SMS reminders + replies</span>
              <span className="ml-1 text-[var(--color-ink-muted)]">
                — appointment confirmations, 24h reminders, two-way messaging with the clinic. Reply STOP at any time.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {err && (
        <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {err}
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        {savedToast && (
          <span className="text-xs font-semibold text-emerald-700">Saved ✓</span>
        )}
        <button type="submit" disabled={saving} className="btn btn-gold disabled:opacity-70">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  placeholder,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      />
    </label>
  );
}
