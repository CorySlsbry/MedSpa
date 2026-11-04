"use client";

/**
 * BookingModal — full-month calendar + time-slot picker for booking a demo
 * call with Cory directly on the marketing page (no email round-trip).
 *
 * Constraints (per product):
 *   - 15-minute time slots visible to the user
 *   - Each booked slot blocks 30 min on Cory's calendar (so adjacent
 *     slots are mutually exclusive)
 *   - Window 11:00 AM – 1:30 PM Mountain Time (last slot = 1:30, ends 2:00)
 *   - Skip weekends and past dates
 *   - Browse current and next month
 *
 * Stages: pick date → pick time → enter contact → confirmation.
 *
 * On submit, POST /api/demo/book persists the booking + emails Cory + sends
 * the user a confirmation with a Google Calendar quick-add link.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, ChevronLeft, ChevronRight, Check, X } from "lucide-react";

const TIME_SLOTS = [
  "11:00", "11:15", "11:30", "11:45",
  "12:00", "12:15", "12:30", "12:45",
  "13:00", "13:15", "13:30",
];
const TZ = "America/Denver";

type Step = "calendar" | "slot" | "details" | "confirmed";

type Booking = { date: string; time: string };

function pad(n: number) { return n.toString().padStart(2, "0"); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function fmt12(t24: string): string {
  const [h, m] = t24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ampm}`;
}

/** Add 15 min to a "HH:MM" string (24h). */
function addMin(t: string, mins: number): string {
  const [h, m] = t.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** A slot at time T is unavailable if any booking B has |B - T| < 30min. */
function isSlotTaken(slot: string, bookings: string[]): boolean {
  const slotMin = (() => {
    const [h, m] = slot.split(":").map(Number);
    return h * 60 + m;
  })();
  for (const b of bookings) {
    const [h, m] = b.split(":").map(Number);
    const bMin = h * 60 + m;
    if (Math.abs(bMin - slotMin) < 30) return true;
  }
  return false;
}

function buildMonthGrid(year: number, month: number): (Date | null)[] {
  // month is 0-11
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function BookingModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("calendar");
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [bookingsForDate, setBookingsForDate] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [clinic, setClinic] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open/close
  useEffect(() => {
    if (open) {
      setStep("calendar");
      setSelectedDate(null);
      setSelectedTime(null);
      setError(null);
    }
  }, [open]);

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Fetch availability when a date is picked
  useEffect(() => {
    if (!selectedDate) return;
    setLoadingSlots(true);
    setBookingsForDate([]);
    fetch(`/api/demo/availability?date=${selectedDate}`)
      .then((r) => r.json())
      .then((j: { booked?: string[] }) => setBookingsForDate(j.booked ?? []))
      .catch(() => setBookingsForDate([]))
      .finally(() => setLoadingSlots(false));
  }, [selectedDate]);

  const monthCells = useMemo(
    () => buildMonthGrid(viewMonth.year, viewMonth.month),
    [viewMonth],
  );

  const monthLabel = useMemo(() => {
    return new Date(viewMonth.year, viewMonth.month, 1).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
  }, [viewMonth]);

  function isDateBookable(d: Date): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) return false;
    // Skip weekends (Cory is Mon-Fri)
    const day = d.getDay();
    if (day === 0 || day === 6) return false;
    // Skip dates more than 30 days out
    const max = new Date();
    max.setDate(max.getDate() + 30);
    if (d > max) return false;
    return true;
  }

  function nextMonth() {
    setViewMonth((v) => {
      const m = v.month + 1;
      return m > 11 ? { year: v.year + 1, month: 0 } : { ...v, month: m };
    });
  }
  function prevMonth() {
    const now = new Date();
    if (viewMonth.year === now.getFullYear() && viewMonth.month === now.getMonth()) return;
    setViewMonth((v) => {
      const m = v.month - 1;
      return m < 0 ? { year: v.year - 1, month: 11 } : { ...v, month: m };
    });
  }

  async function submit() {
    if (!selectedDate || !selectedTime) return;
    if (!name.trim() || !email.trim() || !clinic.trim()) {
      setError("Name, email, and clinic name are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          time: selectedTime,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          clinic_name: clinic.trim(),
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || "Could not book that time. Try another slot.");
      }
      setStep("confirmed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-navy-deep)]/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-[var(--color-paper)] shadow-2xl">
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-cream-deep)] text-[var(--color-ink-soft)] transition hover:bg-[var(--color-line)]"
        >
          <X className="h-4 w-4" strokeWidth={2.5} />
        </button>

        {/* Header */}
        <div className="border-b border-[var(--color-line)] bg-gradient-to-br from-[var(--color-cream)] to-[var(--color-cream-deep)] px-7 pb-5 pt-7">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--color-gold-deep)]">
            <CalendarDays className="h-3.5 w-3.5" strokeWidth={2.5} />
            15-min Aesthera demo with Cory
          </div>
          <h2 id="booking-title" className="mt-2 font-display text-2xl font-bold text-[var(--color-navy)] md:text-3xl">
            {step === "calendar" && "Pick a date"}
            {step === "slot" && "Pick a time"}
            {step === "details" && "Just a few details"}
            {step === "confirmed" && "You're booked."}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            {step === "calendar" && "All times Mountain (Salt Lake / Denver). Mon–Fri, 11:00 AM – 1:30 PM."}
            {step === "slot" && selectedDate && (
              <>Available slots on <strong>{new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</strong>.</>
            )}
            {step === "details" && "We'll send a calendar invite the moment you confirm."}
            {step === "confirmed" && "Calendar invite is on the way."}
          </p>
        </div>

        {/* Body */}
        <div className="px-7 pb-7 pt-5">
          {/* Stepper */}
          {step !== "confirmed" && (
            <ol className="mb-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[var(--color-ink-muted)]">
              {(["calendar", "slot", "details"] as const).map((s, i) => {
                const active = step === s;
                const done = (["calendar", "slot", "details"] as const).indexOf(step) > i;
                return (
                  <li key={s} className="flex flex-1 items-center gap-2">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] ${
                      active ? "bg-[var(--color-gold)] text-[var(--color-navy-deep)]" :
                      done ? "bg-[var(--color-teal)] text-[var(--color-cream)]" :
                      "bg-[var(--color-line)] text-[var(--color-ink-muted)]"
                    }`}>
                      {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className={active ? "text-[var(--color-navy)]" : ""}>
                      {s === "calendar" ? "Date" : s === "slot" ? "Time" : "Details"}
                    </span>
                    {i < 2 && <span className="ml-1 h-0.5 flex-1 bg-[var(--color-line)]" />}
                  </li>
                );
              })}
            </ol>
          )}

          {/* CALENDAR */}
          {step === "calendar" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-ink-soft)] transition hover:bg-[var(--color-cream-deep)] disabled:opacity-30"
                  disabled={(() => {
                    const now = new Date();
                    return viewMonth.year === now.getFullYear() && viewMonth.month === now.getMonth();
                  })()}
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-5 w-5" strokeWidth={2} />
                </button>
                <div className="font-display text-lg font-bold text-[var(--color-navy)]">{monthLabel}</div>
                <button
                  type="button"
                  onClick={nextMonth}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-ink-soft)] transition hover:bg-[var(--color-cream-deep)]"
                  aria-label="Next month"
                >
                  <ChevronRight className="h-5 w-5" strokeWidth={2} />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-muted)]">
                {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => <div key={d}>{d}</div>)}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-1.5">
                {monthCells.map((d, i) => {
                  if (!d) return <div key={i} aria-hidden />;
                  const bookable = isDateBookable(d);
                  const isToday = ymd(d) === ymd(new Date());
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (!bookable) return;
                        setSelectedDate(ymd(d));
                        setStep("slot");
                      }}
                      disabled={!bookable}
                      className={`relative aspect-square rounded-lg text-sm font-semibold transition ${
                        bookable
                          ? "bg-[var(--color-cream-deep)] text-[var(--color-navy)] hover:bg-[var(--color-gold)] hover:text-[var(--color-navy-deep)]"
                          : "cursor-not-allowed bg-transparent text-[var(--color-ink-muted)]/30"
                      }`}
                      aria-label={`Pick ${d.toDateString()}`}
                    >
                      {d.getDate()}
                      {isToday && bookable && (
                        <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--color-gold)]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* SLOTS */}
          {step === "slot" && selectedDate && (
            <div>
              {loadingSlots ? (
                <div className="py-12 text-center text-sm text-[var(--color-ink-muted)]">Checking availability…</div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {TIME_SLOTS.map((t) => {
                    const taken = isSlotTaken(t, bookingsForDate);
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={taken}
                        onClick={() => {
                          setSelectedTime(t);
                          setStep("details");
                        }}
                        className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-3 text-sm font-semibold transition ${
                          taken
                            ? "cursor-not-allowed border-[var(--color-line)] bg-[var(--color-cream-deep)]/40 text-[var(--color-ink-muted)]/50 line-through"
                            : "border-[var(--color-line)] bg-white text-[var(--color-navy)] hover:border-[var(--color-gold)] hover:bg-[var(--color-gold)]/10"
                        }`}
                      >
                        <Clock className="h-3.5 w-3.5" strokeWidth={2} />
                        {fmt12(t)}
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={() => setStep("calendar")}
                className="mt-5 text-xs font-semibold text-[var(--color-teal)] hover:underline"
              >
                ← Pick a different date
              </button>
            </div>
          )}

          {/* DETAILS */}
          {step === "details" && selectedDate && selectedTime && (
            <div>
              <div className="mb-5 flex items-center gap-3 rounded-lg border border-[var(--color-gold)]/40 bg-[var(--color-gold)]/10 px-4 py-3 text-sm">
                <CalendarDays className="h-4 w-4 text-[var(--color-gold-deep)]" strokeWidth={2.5} />
                <div className="flex-1">
                  <div className="font-semibold text-[var(--color-navy)]">
                    {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    {" · "}
                    {fmt12(selectedTime)} MT
                  </div>
                  <div className="text-[11px] text-[var(--color-ink-muted)]">15-minute call · Cory will email a Google Meet link</div>
                </div>
                <button
                  type="button"
                  onClick={() => setStep("slot")}
                  className="text-xs font-semibold text-[var(--color-teal)] hover:underline"
                >
                  Change
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input label="Your name" value={name} onChange={setName} required autoComplete="name" />
                <Input label="Email" value={email} onChange={setEmail} type="email" required autoComplete="email" />
                <Input label="Phone" value={phone} onChange={setPhone} type="tel" autoComplete="tel" />
                <Input label="Clinic name" value={clinic} onChange={setClinic} required autoComplete="organization" />
              </div>
              <label className="mt-3 block">
                <span className="block text-sm font-semibold text-[var(--color-navy)]">
                  What would you like to focus on? <span className="font-normal text-[var(--color-ink-muted)]">(optional)</span>
                </span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="mt-1.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
                  placeholder="Current POS, biggest pain, multi-location, AI marketing..."
                />
              </label>

              {error && (
                <div className="mt-4 rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="btn btn-gold mt-5 w-full justify-center disabled:cursor-wait disabled:opacity-70"
                data-cta="Hero · Book demo"
              >
                {submitting ? "Booking…" : `Confirm — ${fmt12(selectedTime)} MT`}
              </button>
              <p className="mt-3 text-center text-[11px] text-[var(--color-ink-muted)]">
                We&apos;ll send a calendar invite + Google Meet link the moment you confirm.
              </p>
            </div>
          )}

          {/* CONFIRMED */}
          {step === "confirmed" && (
            <div className="py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-teal)]/10 text-[var(--color-teal)]">
                <Check className="h-7 w-7" strokeWidth={3} />
              </div>
              <h3 className="mt-5 font-display text-xl font-bold text-[var(--color-navy)]">
                Booked for {selectedDate && new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} at {selectedTime && fmt12(selectedTime)} MT
              </h3>
              <p className="mt-3 text-[var(--color-ink-soft)]">
                Calendar invite + Google Meet link landed in your inbox at <strong>{email}</strong>. See you then.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-ghost mt-6 justify-center"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-[var(--color-navy)]">
        {label} {required && <span className="text-[var(--color-gold)]">*</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        required={required}
        autoComplete={autoComplete}
        className="mt-1.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm shadow-sm focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-[var(--color-teal)]/20"
      />
    </label>
  );
}

// keep TZ ref so it's not flagged unused if we later wire timezone display
void TZ;
void addMin;
