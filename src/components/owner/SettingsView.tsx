"use client";

import { useState } from "react";
import type { TenantSettings } from "@/app/owner/settings/page";
import SmsLineCard from "./SmsLineCard";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export default function SettingsView({ initial }: { initial: TenantSettings }) {
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState(initial.primaryColor ?? "#b98f42");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const origin =
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "https://aesthera.io";
  const bookingUrl = `${origin}/embed/${initial.slug}/book`;
  const embedSnippet = `<script src="${origin}/embed.js" data-clinic="${initial.slug}" defer></script>`;

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const payload: Record<string, unknown> = {
      name: String(fd.get("name") || "").trim(),
      timezone: String(fd.get("timezone") || "").trim(),
      primary_color: String(fd.get("primary_color") || "").trim() || null,
      logo_url: String(fd.get("logo_url") || "").trim() || null,
      google_review_url: String(fd.get("google_review_url") || "").trim() || null,
    };
    try {
      const res = await fetch("/api/owner/settings", {
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
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-3">
      <form
        onSubmit={onSubmit}
        className="md:col-span-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6"
      >
        <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
          Clinic info
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field
            label="Clinic name"
            name="name"
            defaultValue={initial.name}
            required
          />
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Timezone
            </span>
            <select
              name="timezone"
              defaultValue={initial.timezone}
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
        </div>

        <h3 className="mt-8 font-display text-lg font-bold text-[var(--color-navy)]">
          Branding
        </h3>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          These are used on the embedded booking widget and client emails.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Primary color (hex)
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-12 cursor-pointer rounded border border-[var(--color-line)]"
              />
              <input
                name="primary_color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#b98f42"
                className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 font-mono text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
              />
            </div>
          </label>
          <Field
            label="Logo URL"
            name="logo_url"
            type="url"
            defaultValue={initial.logoUrl ?? ""}
            placeholder="https://yourclinic.com/logo.png"
          />
        </div>

        <div className="mt-8">
          <SmsLineCard
            initialNumber={initial.twilioPhoneNumber}
            initialSubaccountSid={initial.twilioSubaccountSid}
          />
        </div>

        <h3 className="mt-8 font-display text-lg font-bold text-[var(--color-navy)]">
          Reviews
        </h3>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          Your Google Business review URL. Aesthera emails this to clients
          ~24 hours after a completed visit.
        </p>
        <div className="mt-4 max-w-md">
          <Field
            label="Google review URL"
            name="google_review_url"
            type="url"
            defaultValue={initial.googleReviewUrl ?? ""}
            placeholder="https://g.page/r/..."
          />
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

      <aside className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-5">
        <h2 className="font-display text-base font-bold text-[var(--color-navy)]">
          Account
        </h2>
        <dl className="mt-4 space-y-3 text-sm">
          <Row label="Owner" value={initial.ownerEmail} />
          <Row label="Slug" value={<code className="font-mono text-xs">{initial.slug}</code>} />
          <Row
            label="Plan"
            value={
              <span className="inline-flex rounded-full bg-[var(--color-gold)]/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-[var(--color-gold-deep)]">
                {initial.subscriptionTier.replace(/_/g, "-")}
              </span>
            }
          />
          <Row label="Status" value={initial.subscriptionStatus} />
          {initial.trialEndsAt && (
            <Row label="Trial ends" value={initial.trialEndsAt.toLocaleDateString()} />
          )}
          <Row
            label="HIPAA BAA"
            value={
              initial.hipaaBaaSignedAt ? (
                <span className="text-emerald-700">
                  ✓ {initial.hipaaBaaSignedAt.toLocaleDateString()}
                </span>
              ) : (
                <span className="text-amber-700">Not yet signed</span>
              )
            }
          />
          {initial.createdAt && (
            <Row label="Joined" value={initial.createdAt.toLocaleDateString()} />
          )}
        </dl>
        <p className="mt-5 text-[10px] text-[var(--color-ink-muted)]">
          To change your tier or sign a HIPAA BAA, contact{" "}
          <a
            href="mailto:support@aesthera.io"
            className="text-[var(--color-teal)] hover:underline"
          >
            Aesthera support
          </a>
          .
        </p>
      </aside>
      </div>

      {/* Embed booking widget */}
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6">
        <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
          Embed booking widget
        </h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Drop one line into your existing site. The widget pulls your service
          catalog, branding, and AI Concierge — clients book without leaving
          your domain.
        </p>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Embed snippet (paste before &lt;/body&gt;)
              </span>
              <button
                type="button"
                onClick={() => copy("snippet", embedSnippet)}
                className="text-xs font-semibold text-[var(--color-teal)] hover:underline"
              >
                {copiedKey === "snippet" ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="mt-2 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] p-3 font-mono text-[11px] text-[var(--color-navy)]">{embedSnippet}</pre>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                Direct booking URL
              </span>
              <button
                type="button"
                onClick={() => copy("url", bookingUrl)}
                className="text-xs font-semibold text-[var(--color-teal)] hover:underline"
              >
                {copiedKey === "url" ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="mt-2 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] p-3 font-mono text-[11px] text-[var(--color-navy)]">{bookingUrl}</pre>

            <p className="mt-4 text-[11px] text-[var(--color-ink-muted)]">
              The widget auto-resizes inside an iframe. Branding (logo, primary
              color above) shows up in the widget. Bookings land in
              /owner/appointments.
            </p>
          </div>

          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
              Live preview
            </span>
            <div className="mt-2 overflow-hidden rounded-lg border border-[var(--color-line)] bg-white">
              <iframe
                title="Embed booking widget preview"
                src={bookingUrl}
                style={{ width: "100%", height: "420px", border: "none" }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="text-right font-medium text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
