/**
 * POST /api/demo/book — book a 15-min Aesthera demo slot.
 *
 * Constraints:
 *   - Window 11:00–13:30 Mountain (last slot 13:30 ends 14:00)
 *   - Each booking reserves a 30-min event on Cory's calendar
 *   - Slots 15 min apart; adjacent slots overlap each other's 30-min reservation
 *   - Mon–Fri only
 *
 * This endpoint:
 *   1. Validates the slot is in the allowed grid
 *   2. Re-checks availability inside a Firestore transaction (no double-book)
 *   3. Persists demo_bookings doc + lead doc + contact (so it shows up in CRM)
 *   4. Sends an iCal calendar invite to the prospect (Resend, attached .ics)
 *   5. Sends Cory a notification with the same .ics
 *
 * Google Calendar API write: deferred — for now the .ics invite is the
 * source of truth; both parties accept it. Wire google-calendar API
 * write next iteration when OAuth tokens are persisted on the platform
 * account.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { checkRateLimit, DEMO_FORM_LIMIT } from "@/lib/rate-limit";
import { EMAIL_FROM } from "@/lib/email";
import { createDemoCalendarEvent } from "@/lib/admin-google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TIMES = new Set([
  "11:00", "11:15", "11:30", "11:45",
  "12:00", "12:15", "12:30", "12:45",
  "13:00", "13:15", "13:30",
]);

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time"),
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().toLowerCase().email().max(320),
  phone: z.string().trim().max(40).nullish(),
  clinic_name: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullish(),
});

function getIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/** Convert "HH:MM" to absolute milliseconds since epoch in America/Denver. */
function localDenverToUtc(dateYmd: string, timeHm: string): Date {
  // Build an ISO string with a -07:00 or -06:00 offset by figuring out DST manually.
  // Simpler: construct a Date in UTC-presumed form then nudge by the local tz offset.
  // Use Intl to compute the UTC offset for that wall-clock time in Denver.
  const [y, mo, d] = dateYmd.split("-").map(Number);
  const [hh, mm] = timeHm.split(":").map(Number);
  // Estimate: build a Date as if Denver wall-clock equals UTC, then read back in
  // America/Denver to compute the actual offset, then shift.
  const utcGuess = new Date(Date.UTC(y, mo - 1, d, hh, mm));
  // Format the UTC time as it would render in Denver tz
  const tzName = "America/Denver";
  const denverParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzName, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(utcGuess);
  const get = (t: string) => Number(denverParts.find((p) => p.type === t)?.value ?? "0");
  const denverGuess = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offsetMs = utcGuess.getTime() - denverGuess;
  return new Date(utcGuess.getTime() + offsetMs);
}

/** Build an .ics file body for a 30-min Cory↔prospect demo. */
function buildIcs(args: {
  uid: string;
  startUtc: Date;
  endUtc: Date;
  summary: string;
  description: string;
  attendeeEmail: string;
  attendeeName: string;
  organizerEmail: string;
}): string {
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aesthera//Demo Booking//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${args.uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(args.startUtc)}`,
    `DTEND:${fmt(args.endUtc)}`,
    `SUMMARY:${args.summary.replace(/\n/g, "\\n")}`,
    `DESCRIPTION:${args.description.replace(/\n/g, "\\n")}`,
    `ORGANIZER;CN=Cory at Aesthera:mailto:${args.organizerEmail}`,
    `ATTENDEE;CN=${args.attendeeName};RSVP=TRUE:mailto:${args.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export async function POST(req: Request) {
  const ip = getIp(req);
  if (ip) {
    const rl = checkRateLimit(`demo-book:${ip}`, DEMO_FORM_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Try again shortly." },
        { status: 429 },
      );
    }
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;
  if (!ALLOWED_TIMES.has(data.time)) {
    return NextResponse.json({ error: "That time is outside the demo window." }, { status: 400 });
  }
  // Validate date is a weekday + within next 30 days
  const [y, mo, d] = data.date.split("-").map(Number);
  const dateLocal = new Date(y, mo - 1, d);
  const dow = dateLocal.getDay();
  if (dow === 0 || dow === 6) {
    return NextResponse.json({ error: "Demos run Monday–Friday only." }, { status: 400 });
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dateLocal < today) {
    return NextResponse.json({ error: "Pick a future date." }, { status: 400 });
  }
  const max = new Date();
  max.setDate(max.getDate() + 31);
  if (dateLocal > max) {
    return NextResponse.json({ error: "Pick a date within the next 30 days." }, { status: 400 });
  }

  // Atomic book — re-check no overlapping slot already exists
  const startUtc = localDenverToUtc(data.date, data.time);
  const endUtc = new Date(startUtc.getTime() + 30 * 60 * 1000);

  let bookingId: string | null = null;
  try {
    bookingId = await db().runTransaction(async (trx) => {
      // Read all bookings on that date
      const ref = db()
        .collection("demo_bookings")
        .where("date", "==", data.date)
        .where("status", "==", "booked");
      const snap = await trx.get(ref);
      const conflict = snap.docs.some((doc) => {
        const t = (doc.data() as { time: string }).time;
        const [h, m] = t.split(":").map(Number);
        const [eh, em] = data.time.split(":").map(Number);
        return Math.abs((h * 60 + m) - (eh * 60 + em)) < 30;
      });
      if (conflict) {
        throw new Error("That slot is no longer available — pick another.");
      }
      const newRef = db().collection("demo_bookings").doc();
      trx.create(newRef, {
        date: data.date,
        time: data.time,
        timezone: "America/Denver",
        starts_at_utc: Timestamp.fromDate(startUtc),
        ends_at_utc: Timestamp.fromDate(endUtc),
        contact_name: data.name,
        contact_email: data.email,
        contact_phone: data.phone ?? null,
        clinic_name: data.clinic_name,
        notes: data.notes ?? null,
        status: "booked",
        created_at: now(),
        ip,
      });
      writeAuditInTx(trx, {
        action: "lead.create",
        actorEmail: data.email,
        targetType: "demo_booking",
        targetId: newRef.id,
        after: {
          date: data.date,
          time: data.time,
          clinic: data.clinic_name,
        },
        ip,
        userAgent: req.headers.get("user-agent"),
      });
      return newRef.id;
    });
  } catch (err) {
    const msg = (err as { message?: string }).message ?? "Could not book that time.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  // Side effects (best-effort)
  const organizerEmail = process.env.PLATFORM_DEMO_NOTIFY_EMAIL || "person1@example.com";
  const ics = buildIcs({
    uid: `${bookingId}@aesthera.io`,
    startUtc,
    endUtc,
    summary: `Aesthera demo · ${data.clinic_name}`,
    description: `15-min Aesthera demo with Cory.\n\nClinic: ${data.clinic_name}\nProspect: ${data.name} <${data.email}>${data.phone ? `\nPhone: ${data.phone}` : ""}${data.notes ? `\n\nNotes:\n${data.notes}` : ""}`,
    attendeeEmail: data.email,
    attendeeName: data.name,
    organizerEmail,
  });

  // Calendar event creation (best-effort). If the platform has Google
  // connected at /admin/integrations, this writes a real event with a
  // Google Meet link. If not, the .ics in the email is the source of
  // truth and Cory accepts it manually.
  void (async () => {
    const cal = await createDemoCalendarEvent({
      startUtc,
      endUtc,
      prospectName: data.name,
      prospectEmail: data.email,
      clinicName: data.clinic_name,
      notes: data.notes ?? null,
      bookingId,
    });
    if (cal && bookingId) {
      await db().collection("demo_bookings").doc(bookingId).update({
        google_event_id: cal.eventId,
        google_event_link: cal.htmlLink,
        google_meet_url: cal.meetUrl,
      }).catch(() => {});
    }
  })().catch((err) => console.error("[demo-book] calendar event", err));

  void sendBookingEmails({
    booking: { id: bookingId, ...data, startUtc, endUtc },
    ics,
    organizerEmail,
  }).catch((err) => console.error("[demo-book] email send", err));

  return NextResponse.json({ ok: true, booking_id: bookingId });
}

async function sendBookingEmails(args: {
  booking: {
    id: string;
    date: string;
    time: string;
    name: string;
    email: string;
    phone?: string | null;
    clinic_name: string;
    notes?: string | null;
    startUtc: Date;
    endUtc: Date;
  };
  ics: string;
  organizerEmail: string;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.log("[demo-book] no RESEND_API_KEY", args.booking.id);
    return;
  }
  const b = args.booking;
  const dateLabel = b.startUtc.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "America/Denver",
  });
  const timeLabel = b.startUtc.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/Denver",
  });

  const icsB64 = Buffer.from(args.ics, "utf8").toString("base64");
  const attachment = {
    filename: `aesthera-demo-${b.id}.ics`,
    content: icsB64,
    content_type: "text/calendar; method=REQUEST; charset=UTF-8",
  };

  // Prospect confirmation
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.support,
      to: [b.email],
      reply_to: args.organizerEmail,
      subject: `Aesthera demo confirmed — ${dateLabel} · ${timeLabel} MT`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1b2636">
          <p>Hi ${escapeHtml(b.name.split(" ")[0])},</p>
          <p>You&apos;re booked for a 15-min Aesthera demo with Cory.</p>
          <p style="background:#fdf9f3;border-left:3px solid #b98f42;padding:14px 16px;border-radius:6px">
            <strong>${escapeHtml(dateLabel)}</strong><br>
            ${escapeHtml(timeLabel)} Mountain Time
          </p>
          <p>The calendar invite is attached. Cory will email a Google Meet link the morning of the call.</p>
          <p>If you need to reschedule, reply to this email.</p>
          <p style="font-size:12px;color:#888;margin-top:24px">
            Aesthera · MedSpa Management Software
          </p>
        </div>
      `,
      attachments: [attachment],
    }),
  });

  // Cory notification
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.leads,
      to: [args.organizerEmail],
      reply_to: b.email,
      subject: `📅 Demo booked — ${b.clinic_name} · ${dateLabel} ${timeLabel}`,
      html: `
        <h2>New demo booking</h2>
        <p><strong>When:</strong> ${escapeHtml(dateLabel)} · ${escapeHtml(timeLabel)} MT (30-min hold on calendar)</p>
        <p><strong>Clinic:</strong> ${escapeHtml(b.clinic_name)}</p>
        <p><strong>Prospect:</strong> ${escapeHtml(b.name)} &lt;<a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>&gt;</p>
        <p><strong>Phone:</strong> ${escapeHtml(b.phone || "—")}</p>
        ${b.notes ? `<p><strong>Notes:</strong></p><blockquote style="border-left:3px solid #07667A;padding-left:12px">${escapeHtml(b.notes).replace(/\n/g,"<br>")}</blockquote>` : ""}
        <p style="font-size:12px;color:#888">Booking ID: ${b.id} · The .ics is attached — accept it to add the event to your calendar.</p>
      `,
      attachments: [attachment],
    }),
  });
}
