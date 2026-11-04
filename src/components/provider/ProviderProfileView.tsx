"use client";

import { useState } from "react";
import type { ProviderProfile, LocationOption } from "@/app/provider/profile/page";

export default function ProviderProfileView({
  initial,
  locations,
}: {
  initial: ProviderProfile;
  locations: LocationOption[];
}) {
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [color, setColor] = useState(initial.schedulingColor ?? "#07667a");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      full_name: String(fd.get("full_name") || "").trim(),
      title: String(fd.get("title") || "").trim() || null,
      phone: String(fd.get("phone") || "").trim() || null,
      scheduling_color: color,
      default_location_id: String(fd.get("default_location_id") || "") || null,
    };
    try {
      const res = await fetch("/api/provider/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error || "Could not save.");
      } else {
        setSuccessMsg("Saved.");
        setTimeout(() => setSuccessMsg(null), 2000);
      }
    } catch {
      setErrorMsg("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 max-w-2xl"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Full name" name="full_name" defaultValue={initial.fullName} required />
        <Field
          label="Title"
          name="title"
          defaultValue={initial.title ?? ""}
          placeholder="RN, NP, Aesthetician..."
        />
        <Field label="Email" name="email" defaultValue={initial.email} disabled />
        <Field label="Phone" name="phone" type="tel" defaultValue={initial.phone ?? ""} />
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
            Scheduling color
          </span>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-12 cursor-pointer rounded border border-[var(--color-line)]"
            />
            <input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 font-mono text-sm shadow-sm"
            />
          </div>
        </label>
        {locations.length > 0 && (
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Default location
            </span>
            <select
              name="default_location_id"
              defaultValue={initial.defaultLocationId ?? ""}
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            >
              <option value="">— None —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {errorMsg && (
        <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="mt-4 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          {successMsg}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="btn btn-gold disabled:cursor-wait disabled:opacity-70"
        >
          {saving ? "Saving..." : "Save changes"}
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
  disabled,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  disabled?: boolean;
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
        disabled={disabled}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20 disabled:cursor-not-allowed disabled:bg-[var(--color-cream-deep)] disabled:text-[var(--color-ink-muted)]"
      />
    </label>
  );
}
