"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

const STARTER_SERVICES = [
  { name: "Botox — 30 units", category: "injectables", duration_minutes: 30, price: 450 },
  { name: "Filler — 1 syringe", category: "injectables", duration_minutes: 45, price: 700 },
  { name: "HydraFacial", category: "facial", duration_minutes: 60, price: 200 },
  { name: "Microneedling", category: "facial", duration_minutes: 75, price: 350 },
  { name: "Laser hair removal — small area", category: "laser", duration_minutes: 30, price: 150 },
  { name: "IV hydration drip", category: "iv_therapy", duration_minutes: 45, price: 175 },
  { name: "Consultation (free)", category: "consultation", duration_minutes: 30, price: 0 },
];

type Step = 1 | 2 | 3 | 4 | 5;

export default function OnboardingWizard({
  tenantName,
  tenantId,
  tenantTimezone,
  tenantPrimaryColor,
  tenantLogoUrl,
}: {
  tenantName: string;
  tenantId: string;
  tenantTimezone: string;
  tenantPrimaryColor: string | null;
  tenantLogoUrl: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step 1: clinic info
  const [clinicName, setClinicName] = useState(tenantName);
  const [timezone, setTimezone] = useState(tenantTimezone);
  const [primaryColor, setPrimaryColor] = useState(tenantPrimaryColor ?? "#b98f42");
  const [logoUrl, setLogoUrl] = useState(tenantLogoUrl ?? "");

  // Step 2: location
  const [locName, setLocName] = useState("");
  const [locAddress, setLocAddress] = useState("");
  const [locCity, setLocCity] = useState("");
  const [locState, setLocState] = useState("");
  const [locPostal, setLocPostal] = useState("");
  const [locPhone, setLocPhone] = useState("");

  // Step 3: services
  const [pickedServices, setPickedServices] = useState<Set<string>>(
    new Set(STARTER_SERVICES.map((s) => s.name)),
  );

  function next() {
    setError(null);
    setStep((s) => (Math.min(5, s + 1) as Step));
  }
  function back() {
    setError(null);
    setStep((s) => (Math.max(1, s - 1) as Step));
  }

  async function saveClinic(): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/owner/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: clinicName,
          timezone,
          primary_color: primaryColor,
          logo_url: logoUrl || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || "Could not save clinic info.");
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function saveLocation(): Promise<boolean> {
    if (!locName.trim()) {
      setError("Location name is required.");
      return false;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/owner/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: locName.trim(),
          address_line_1: locAddress || undefined,
          city: locCity || undefined,
          state: locState || undefined,
          postal_code: locPostal || undefined,
          phone: locPhone || undefined,
          timezone,
          is_primary: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || "Could not create location.");
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function saveServices(): Promise<boolean> {
    setBusy(true);
    try {
      let created = 0;
      for (const svc of STARTER_SERVICES) {
        if (!pickedServices.has(svc.name)) continue;
        const res = await fetch("/api/owner/services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: svc.name,
            category: svc.category,
            duration_minutes: svc.duration_minutes,
            price: svc.price > 0 ? svc.price : undefined,
          }),
        });
        if (res.ok) created++;
      }
      if (created === 0 && pickedServices.size > 0) {
        setError("Couldn't create services. You can add them later.");
      }
      return true; // never block on this step
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    try {
      const res = await fetch("/api/owner/onboarding/complete", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || "Could not complete onboarding.");
        setBusy(false);
        return;
      }
      router.replace("/owner");
    } catch {
      setError("Network error.");
      setBusy(false);
    }
  }

  async function handleNext() {
    if (step === 1) {
      if (!(await saveClinic())) return;
    } else if (step === 2) {
      if (!(await saveLocation())) return;
    } else if (step === 3) {
      if (!(await saveServices())) return;
    }
    next();
  }

  const stepLabels = ["Clinic", "Location", "Services", "Embed", "Done"];

  return (
    <div className="min-h-screen bg-[var(--color-cream)] py-10 px-4">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 text-center">
          <div
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl font-display text-xl font-bold text-white"
            style={{ backgroundColor: primaryColor }}
          >
            {clinicName.slice(0, 1)}
          </div>
          <h1 className="mt-3 font-display text-2xl font-bold text-[var(--color-navy)]">
            Welcome to Aesthera
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Five quick steps to get {clinicName} live. About 4 minutes.
          </p>
        </header>

        {/* Stepper */}
        <ol className="mb-6 flex items-center gap-2">
          {stepLabels.map((label, i) => {
            const n = (i + 1) as Step;
            const done = n < step;
            const active = n === step;
            return (
              <li key={label} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    done
                      ? "bg-emerald-600 text-white"
                      : active
                        ? "bg-[var(--color-navy)] text-[var(--color-cream)]"
                        : "bg-[var(--color-line)] text-[var(--color-ink-muted)]"
                  }`}
                >
                  {done ? "✓" : n}
                </span>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${
                    active ? "text-[var(--color-navy)]" : "text-[var(--color-ink-muted)]"
                  }`}
                >
                  {label}
                </span>
                {i < stepLabels.length - 1 && (
                  <div className={`h-px flex-1 ${done ? "bg-emerald-600" : "bg-[var(--color-line)]"}`} />
                )}
              </li>
            );
          })}
        </ol>

        <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-paper)] p-6 shadow-sm">
          {step === 1 && (
            <div>
              <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
                Confirm clinic info
              </h2>
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                Used in client emails, the embed widget, and consent PDFs.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field label="Clinic name" value={clinicName} onChange={setClinicName} />
                <label className="block">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                    Timezone
                  </span>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
                    Primary color
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-10 w-12 cursor-pointer rounded border border-[var(--color-line)]"
                    />
                    <input
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 font-mono text-sm"
                    />
                  </div>
                </label>
                <Field
                  label="Logo URL (optional)"
                  value={logoUrl}
                  onChange={setLogoUrl}
                  placeholder="https://yourclinic.com/logo.png"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
                Add your first location
              </h2>
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                You can add more locations later from /owner/locations.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field label="Location name" value={locName} onChange={setLocName} placeholder="Park City Aesthetics" />
                <Field label="Phone (optional)" value={locPhone} onChange={setLocPhone} placeholder="(801) 555-0100" />
                <Field
                  label="Address line 1"
                  value={locAddress}
                  onChange={setLocAddress}
                  className="md:col-span-2"
                />
                <Field label="City" value={locCity} onChange={setLocCity} />
                <Field label="State" value={locState} onChange={setLocState} />
                <Field label="Postal code" value={locPostal} onChange={setLocPostal} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
                Pick starter services
              </h2>
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                We&apos;ll pre-populate your catalog with these. You can edit prices and add more later.
              </p>
              <div className="mt-4 space-y-2">
                {STARTER_SERVICES.map((svc) => {
                  const checked = pickedServices.has(svc.name);
                  return (
                    <label
                      key={svc.name}
                      className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition ${
                        checked
                          ? "border-[var(--color-gold)] bg-[var(--color-gold)]/5"
                          : "border-[var(--color-line)] bg-white"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setPickedServices((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(svc.name);
                              else next.delete(svc.name);
                              return next;
                            })
                          }
                        />
                        <div>
                          <div className="text-sm font-semibold text-[var(--color-navy)]">{svc.name}</div>
                          <div className="text-[11px] text-[var(--color-ink-muted)]">
                            {svc.category.replace(/_/g, " ")} · {svc.duration_minutes} min
                          </div>
                        </div>
                      </div>
                      <div className="text-sm font-mono text-[var(--color-ink)]">
                        {svc.price > 0 ? `$${svc.price}` : "Free"}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="font-display text-lg font-bold text-[var(--color-navy)]">
                Embed booking widget on your site
              </h2>
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                Drop one line into your existing site. Clients book without leaving your domain.
                The full snippet + live preview lives in /owner/settings.
              </p>
              <pre className="mt-3 overflow-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-cream)] p-3 font-mono text-[11px] text-[var(--color-navy)]">
{`<script src="${typeof window !== "undefined" ? window.location.origin : ""}/embed.js"
        data-clinic="${tenantId}" defer></script>`}
              </pre>
              <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
                Skip and copy later if you don&apos;t have site access right now.
              </p>
            </div>
          )}

          {step === 5 && (
            <div className="text-center">
              <div
                className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: "#059669" }}
              >
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="mt-3 font-display text-xl font-bold text-[var(--color-navy)]">
                You&apos;re set up.
              </h2>
              <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
                Next: invite providers, build your first consent template, and connect a marketing channel from
                Settings.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={back}
              disabled={step === 1 || busy}
              className="text-xs font-semibold text-[var(--color-ink-muted)] hover:underline disabled:opacity-30"
            >
              ← Back
            </button>
            {step < 5 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={busy}
                className="btn btn-gold text-sm disabled:cursor-wait disabled:opacity-70"
              >
                {busy ? "Saving…" : step === 4 ? "Looks good →" : "Continue →"}
              </button>
            ) : (
              <button
                type="button"
                onClick={complete}
                disabled={busy}
                className="btn btn-gold text-sm disabled:cursor-wait disabled:opacity-70"
              >
                {busy ? "Finalizing…" : "Go to dashboard →"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm"
      />
    </label>
  );
}
