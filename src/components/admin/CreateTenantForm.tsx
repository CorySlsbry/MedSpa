"use client";

import { useState } from "react";

export default function CreateTenantForm() {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const payload = {
      name: String(fd.get("name") || "").trim(),
      type: String(fd.get("type") || "med_spa"),
      owner_email: String(fd.get("owner_email") || "").trim().toLowerCase(),
      owner_full_name: String(fd.get("owner_full_name") || "").trim(),
      subscription_tier: String(fd.get("subscription_tier") || "founding_25"),
      timezone: String(fd.get("timezone") || "America/Denver"),
      trial_days: Number(fd.get("trial_days") || 14),
    };
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok) {
        setSuccessMsg(`Tenant ${body.slug} provisioned. Owner UID ${body.ownerUid}.`);
        formEl.reset();
        // Soft refresh to show the new row
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setErrorMsg(body?.error || "Could not create tenant.");
      }
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5"
    >
      <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
        Provision a tenant
      </h2>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Creates the clinic record + assigns the owner role. The owner can sign
        in via magic link.
      </p>

      <div className="mt-4 space-y-3">
        <Field label="Clinic name" name="name" required placeholder="Park City Aesthetics" />
        <Select label="Type" name="type" defaultValue="med_spa">
          <option value="med_spa">Med spa</option>
          <option value="aesthetic_clinic">Aesthetic clinic</option>
          <option value="iv_lounge">IV lounge</option>
          <option value="wellness_studio">Wellness studio</option>
          <option value="lash_brow_studio">Lash + brow studio</option>
          <option value="head_spa">Head spa</option>
          <option value="other">Other</option>
        </Select>
        <Field label="Owner email" name="owner_email" type="email" required placeholder="person1@example.com" />
        <Field label="Owner full name" name="owner_full_name" required placeholder="Sarah Roberts" />
        <Select label="Tier" name="subscription_tier" defaultValue="founding_25">
          <option value="founding_25">Founding-25 ($99/mo)</option>
          <option value="basic">Basic ($199/mo)</option>
          <option value="growth">Growth ($399/mo)</option>
          <option value="enterprise">Enterprise ($899/mo)</option>
        </Select>
        <Field label="Timezone" name="timezone" defaultValue="America/Denver" />
        <Field label="Trial days" name="trial_days" type="number" defaultValue="14" />

        {errorMsg && (
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            {successMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="btn btn-gold w-full justify-center disabled:cursor-wait disabled:opacity-70"
        >
          {submitting ? "Provisioning..." : "Create tenant"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
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

function Select({
  label,
  name,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      >
        {children}
      </select>
    </label>
  );
}
