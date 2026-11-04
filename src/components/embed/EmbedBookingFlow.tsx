"use client";

import { useEffect, useMemo, useState } from "react";
import ConciergeChat from "./ConciergeChat";
import DepositStep, { type DepositPayload } from "./DepositStep";

type Service = {
  id: string;
  name: string;
  category: string;
  duration_minutes: number;
  price_cents: number | null;
  description: string | null;
  deposit_cents: number | null;
};

type Location = {
  id: string;
  name: string;
  address_line_1: string | null;
  city: string | null;
  state: string | null;
  is_primary: boolean;
};

type Slot = { iso: string; label: string };

type Step = "service" | "location" | "slot" | "contact" | "deposit" | "confirm" | "success";

type BookResult = {
  appointment_id: string;
  service: string;
  provider: string;
  location: string;
  deposit_required?: boolean;
  deposit_client_secret?: string | null;
  deposit_amount_cents?: number | null;
  stripe_account_id?: string | null;
  stripe_publishable_key?: string | null;
};

export default function EmbedBookingFlow({
  slug,
  tenantName,
  primaryColor,
  logoUrl,
}: {
  slug: string;
  tenantName: string;
  primaryColor: string | null;
  logoUrl: string | null;
}) {
  const accent = primaryColor || "#b98f42";
  const [step, setStep] = useState<Step>("service");
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [services, setServices] = useState<Service[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookResult, setBookResult] = useState<BookResult | null>(null);
  const [conciergeOpen, setConciergeOpen] = useState(false);

  const servicesById = useMemo(() => {
    const map: Record<string, Service> = {};
    for (const s of services) map[s.id] = s;
    return map;
  }, [services]);

  // Load catalog
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/embed/${slug}/catalog`);
        const body = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setErrorMsg(body?.error || "Couldn't load this clinic's catalog.");
        } else {
          const svcs: Service[] = body.services || [];
          const locs: Location[] = body.locations || [];
          setServices(svcs);
          setLocations(locs);
          // Auto-select if only one location
          if (locs.length === 1) {
            setSelectedLocation(locs[0]);
          } else {
            const primary = locs.find((l: Location) => l.is_primary);
            if (primary) setSelectedLocation(primary);
          }
          // Preselect service from URL ?service= (e.g. from rebook emails)
          if (typeof window !== "undefined") {
            const sp = new URLSearchParams(window.location.search);
            const wanted = sp.get("service");
            if (wanted) {
              const match = svcs.find(
                (s) => s.name.toLowerCase() === wanted.toLowerCase(),
              );
              if (match) {
                setSelectedService(match);
                setStep(locs.length === 1 || locs.find((l) => l.is_primary) ? "slot" : "location");
              }
            }
          }
        }
      } catch {
        if (alive) setErrorMsg("Network error.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  // Load slots when service + location are picked
  useEffect(() => {
    if (!selectedService || !selectedLocation) return;
    let alive = true;
    setSlotsLoading(true);
    setSlots([]);
    (async () => {
      try {
        const res = await fetch(
          `/api/embed/${slug}/slots?service_id=${encodeURIComponent(selectedService.id)}&location_id=${encodeURIComponent(selectedLocation.id)}&days=14`,
        );
        const body = await res.json();
        if (!alive) return;
        if (!res.ok) {
          setErrorMsg(body?.error || "Couldn't load times.");
        } else {
          setSlots(body.slots || []);
        }
      } catch {
        if (alive) setErrorMsg("Network error.");
      } finally {
        if (alive) setSlotsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, selectedService, selectedLocation]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const day = s.iso.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(s);
    }
    return Array.from(map.entries()).map(([day, items]) => ({ day, items }));
  }, [slots]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white p-8">
        <div className="text-sm text-gray-500">Loading...</div>
      </main>
    );
  }

  if (errorMsg && step === "service") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white p-8">
        <div className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMsg}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-white px-4 py-6 md:px-8 md:py-10">
      {/* Header */}
      <header className="mb-8 flex items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={tenantName} className="h-10 w-auto" />
        ) : (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg font-display text-base font-bold text-white"
            style={{ backgroundColor: accent }}
          >
            {tenantName.slice(0, 1)}
          </div>
        )}
        <div>
          <div className="font-display text-lg font-bold text-gray-900">
            Book at {tenantName}
          </div>
          <Stepper step={step} accent={accent} />
        </div>
      </header>

      {step === "service" && (
        <>
          {services.length > 0 && (
            <button
              type="button"
              onClick={() => setConciergeOpen(true)}
              className="mb-4 flex w-full items-center gap-3 rounded-xl border-2 border-dashed bg-white px-4 py-3 text-left transition hover:shadow-sm"
              style={{ borderColor: accent }}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: accent }}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2zm6 12l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9.9-2.7zM6 14l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9.9-2.7z" />
                </svg>
              </span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-gray-900">Need help choosing?</div>
                <div className="text-xs text-gray-500">Chat with the booking concierge</div>
              </div>
              <span className="text-xs font-semibold" style={{ color: accent }}>
                Start →
              </span>
            </button>
          )}
          <ServicePicker
            services={services}
            accent={accent}
            onPick={(s) => {
              setSelectedService(s);
              setStep(locations.length > 1 && !selectedLocation ? "location" : "slot");
            }}
          />
        </>
      )}

      {step === "location" && (
        <LocationPicker
          locations={locations}
          accent={accent}
          onBack={() => setStep("service")}
          onPick={(l) => {
            setSelectedLocation(l);
            setStep("slot");
          }}
        />
      )}

      {step === "slot" && selectedService && selectedLocation && (
        <SlotPicker
          slotsByDay={slotsByDay}
          loading={slotsLoading}
          accent={accent}
          serviceName={selectedService.name}
          duration={selectedService.duration_minutes}
          locationName={selectedLocation.name}
          onBack={() => setStep(locations.length > 1 ? "location" : "service")}
          onPick={(s) => {
            setSelectedSlot(s);
            setStep("contact");
          }}
        />
      )}

      {step === "contact" && selectedService && selectedSlot && (
        <ContactStep
          accent={accent}
          serviceName={selectedService.name}
          slotLabel={selectedSlot.label}
          onBack={() => setStep("slot")}
          onSubmit={async (contact) => {
            if (!selectedService || !selectedLocation || !selectedSlot) return;
            setBooking(true);
            setErrorMsg(null);
            try {
              const res = await fetch(`/api/embed/${slug}/book`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  service_id: selectedService.id,
                  location_id: selectedLocation.id,
                  starts_at: selectedSlot.iso,
                  client: contact,
                }),
              });
              const body = await res.json();
              if (!res.ok) {
                setErrorMsg(body?.error || "Could not book that slot.");
                if (body?.error?.toLowerCase().includes("just got taken")) {
                  // Refresh slots
                  setStep("slot");
                  setSelectedSlot(null);
                  return;
                }
              } else {
                setBookResult(body);
                if (
                  body.deposit_required &&
                  body.deposit_client_secret &&
                  body.stripe_publishable_key &&
                  body.stripe_account_id
                ) {
                  setStep("deposit");
                } else {
                  setStep("success");
                }
              }
            } catch {
              setErrorMsg("Network error.");
            } finally {
              setBooking(false);
            }
          }}
          submitting={booking}
          errorMsg={errorMsg}
        />
      )}

      {step === "deposit" &&
        bookResult &&
        bookResult.deposit_client_secret &&
        bookResult.deposit_amount_cents &&
        bookResult.stripe_publishable_key &&
        bookResult.stripe_account_id &&
        selectedService &&
        selectedSlot && (
          <DepositStep
            accent={accent}
            payload={
              {
                clientSecret: bookResult.deposit_client_secret,
                amountCents: bookResult.deposit_amount_cents,
                publishableKey: bookResult.stripe_publishable_key,
                connectAccountId: bookResult.stripe_account_id,
              } satisfies DepositPayload
            }
            serviceName={selectedService.name}
            slotLabel={selectedSlot.label}
            onPaid={() => setStep("success")}
          />
        )}

      {step === "success" && bookResult && (
        <SuccessStep
          accent={accent}
          tenantName={tenantName}
          result={bookResult}
        />
      )}

      {conciergeOpen && (
        <ConciergeChat
          slug={slug}
          accent={accent}
          tenantName={tenantName}
          servicesById={Object.fromEntries(
            Object.entries(servicesById).map(([id, s]) => [
              id,
              { name: s.name, category: s.category, duration_minutes: s.duration_minutes },
            ]),
          )}
          onClose={() => setConciergeOpen(false)}
          onPickService={(serviceId) => {
            const svc = servicesById[serviceId];
            if (!svc) return;
            setSelectedService(svc);
            setConciergeOpen(false);
            setStep(locations.length > 1 && !selectedLocation ? "location" : "slot");
          }}
        />
      )}
    </main>
  );
}

function Stepper({ step, accent }: { step: Step; accent: string }) {
  const labels: Record<Step, string> = {
    service: "1 / 4 · Pick a service",
    location: "Pick a location",
    slot: "2 / 4 · Pick a time",
    contact: "3 / 4 · Your info",
    deposit: "4 / 4 · Secure your spot",
    confirm: "Review",
    success: "All booked",
  };
  return (
    <div className="text-xs font-medium" style={{ color: accent }}>
      {labels[step]}
    </div>
  );
}

function ServicePicker({
  services,
  accent,
  onPick,
}: {
  services: Service[];
  accent: string;
  onPick: (s: Service) => void;
}) {
  if (services.length === 0) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        No services published yet. Check back soon.
      </div>
    );
  }
  const byCategory = new Map<string, Service[]>();
  for (const s of services) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category)!.push(s);
  }
  return (
    <div className="space-y-6">
      {Array.from(byCategory.entries()).map(([cat, items]) => (
        <section key={cat}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">
            {cat.replace(/_/g, " ")}
          </h2>
          <div className="space-y-2">
            {items.map((s) => (
              <button
                key={s.id}
                onClick={() => onPick(s)}
                className="block w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-current hover:shadow-sm"
                style={{ color: accent }}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-gray-900">{s.name}</div>
                  <div className="text-sm text-gray-600">
                    {s.duration_minutes} min
                    {s.price_cents != null && (
                      <span className="ml-2 font-mono text-gray-900">
                        ${(s.price_cents / 100).toFixed(0)}
                      </span>
                    )}
                  </div>
                </div>
                {s.description && (
                  <div className="mt-1 text-sm text-gray-500">{s.description}</div>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function LocationPicker({
  locations,
  accent,
  onBack,
  onPick,
}: {
  locations: Location[];
  accent: string;
  onBack: () => void;
  onPick: (l: Location) => void;
}) {
  return (
    <div className="space-y-3">
      <BackButton onClick={onBack} accent={accent} />
      {locations.map((l) => (
        <button
          key={l.id}
          onClick={() => onPick(l)}
          className="block w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-left hover:border-current hover:shadow-sm"
          style={{ color: accent }}
        >
          <div className="flex items-center justify-between">
            <div className="font-semibold text-gray-900">{l.name}</div>
            {l.is_primary && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                style={{ backgroundColor: accent }}
              >
                Primary
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {[l.address_line_1, l.city, l.state].filter(Boolean).join(", ") ||
              "Address TBD"}
          </div>
        </button>
      ))}
    </div>
  );
}

function SlotPicker({
  slotsByDay,
  loading,
  accent,
  serviceName,
  duration,
  locationName,
  onBack,
  onPick,
}: {
  slotsByDay: { day: string; items: Slot[] }[];
  loading: boolean;
  accent: string;
  serviceName: string;
  duration: number;
  locationName: string;
  onBack: () => void;
  onPick: (s: Slot) => void;
}) {
  return (
    <div>
      <BackButton onClick={onBack} accent={accent} />
      <div className="mb-3 text-sm text-gray-600">
        <strong className="text-gray-900">{serviceName}</strong> · {duration} min · at{" "}
        {locationName}
      </div>
      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500">Loading times…</div>
      ) : slotsByDay.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
          No availability in the next 14 days. Try another service.
        </div>
      ) : (
        <div className="space-y-4">
          {slotsByDay.map(({ day, items }) => {
            const dateLabel = new Date(day + "T00:00:00").toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            });
            return (
              <section key={day}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">
                  {dateLabel}
                </h3>
                <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
                  {items.map((s) => {
                    const time = new Date(s.iso).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    });
                    return (
                      <button
                        key={s.iso}
                        onClick={() => onPick(s)}
                        className="rounded border border-gray-200 bg-white px-2 py-2 text-sm transition hover:bg-current hover:text-white"
                        style={{ color: accent }}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ContactStep({
  accent,
  serviceName,
  slotLabel,
  onBack,
  onSubmit,
  submitting,
  errorMsg,
}: {
  accent: string;
  serviceName: string;
  slotLabel: string;
  onBack: () => void;
  onSubmit: (c: { email: string; full_name: string; phone?: string }) => void;
  submitting: boolean;
  errorMsg: string | null;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSubmit({
          email: String(fd.get("email") || "").trim().toLowerCase(),
          full_name: String(fd.get("full_name") || "").trim(),
          phone: String(fd.get("phone") || "").trim() || undefined,
        });
      }}
    >
      <BackButton onClick={onBack} accent={accent} />
      <div className="mb-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
        <strong>{serviceName}</strong> · {slotLabel}
      </div>
      <div className="space-y-3">
        <Field label="Full name" name="full_name" required />
        <Field label="Email" name="email" type="email" required />
        <Field label="Phone (optional)" name="phone" type="tel" />
      </div>
      {errorMsg && (
        <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errorMsg}
        </div>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="mt-5 w-full rounded-lg px-4 py-3 font-semibold text-white transition disabled:cursor-wait disabled:opacity-70"
        style={{ backgroundColor: accent }}
      >
        {submitting ? "Booking…" : "Confirm booking"}
      </button>
    </form>
  );
}

function SuccessStep({
  accent,
  tenantName,
  result,
}: {
  accent: string;
  tenantName: string;
  result: BookResult;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: accent }}
      >
        <svg
          className="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="mt-4 font-display text-xl font-bold text-gray-900">
        You&apos;re booked.
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        <strong>{result.service}</strong> with {result.provider} at {result.location}.
      </p>
      <p className="mt-4 text-xs text-gray-500">
        A confirmation is on its way. {tenantName} will reach out if anything changes.
      </p>
    </div>
  );
}

function BackButton({ onClick, accent }: { onClick: () => void; accent: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 text-xs font-semibold hover:underline"
      style={{ color: accent }}
    >
      ← Back
    </button>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
      />
    </label>
  );
}
