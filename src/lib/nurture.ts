/**
 * Inbound info-nurture sequence.
 *
 * Sends three emails to leads who fill out the "Get more info" form:
 *   Day 0  — Lead with empathy + the 7→1 thesis. Direct dev access.
 *   Day 2  — Charting / photos / consents specifics. AI SOAP draft.
 *   Day 4  — AI marketing engine + Stripe Connect + founding-25 nudge.
 *
 * Tone: warm, first-person Cory, no marketing fluff. Treats the reader
 * like an adult who runs a real clinic. Reply-to is Cory's inbox, not a
 * no-reply. Every email closes with the reminder that they can text or
 * book a call any time — direct line to the developer.
 *
 * Implementation: scheduled_emails Firestore collection + an hourly cron
 * (/api/system/cron/scheduled-emails) that picks up due rows and sends.
 * No external scheduler service needed; we already run Cloud Scheduler.
 */

import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "./firestore";
import { EMAIL_FROM } from "./email";
import {
  renderTemplate,
  templateVarsFromContact,
} from "./workflows";
import type {
  ContactDoc,
  WorkflowDoc,
  WorkflowEnrollmentDoc,
  WorkflowStep,
} from "./firestore-types";

export type NurtureStep =
  | "day_0"   // Immediate — 7→1 thesis
  | "day_2"   // Charting + photos + consents
  | "day_4"   // AI marketing + Stripe Connect + founding-25
  | "day_14"  // Soft check-in: founding-25 still open?
  | "day_30"  // What we've shipped this month
  | "day_60"  // Customer story / before-after pattern
  | "day_90"  // Industry trend value piece
  | "day_180" // 6-month re-engagement
  | "day_365"; // 1-year evergreen tap

/** Fields stamped on a scheduled_emails row by the Resend webhook after the
 * cron has marked it sent. Optional because they only land if the webhook is
 * configured and signed correctly. */
type TrackingFields = {
  resend_id?: string | null;
  delivered_at?: Timestamp | null;
  opens_count?: number;
  last_opened_at?: Timestamp | null;
  clicks_count?: number;
  last_clicked_at?: Timestamp | null;
  bounced_at?: Timestamp | null;
  bounce_reason?: string | null;
  complained_at?: Timestamp | null;
};

export type ScheduledEmailDoc =
  | ({
      type: "info_nurture";
      step: NurtureStep;
      recipient_email: string;
      recipient_name: string;
      clinic_name: string;
      scheduled_at: Timestamp;
      status: "queued" | "sent" | "failed" | "skipped";
      sent_at: Timestamp | null;
      error: string | null;
      created_at: Timestamp;
    } & TrackingFields)
  | ({
      type: "workflow_step";
      workflow_id: string;
      step_index: number;
      enrollment_id: string;
      contact_id: string; // doc id (lowercased email)
      recipient_email: string;
      recipient_name: string;
      clinic_name: string;
      scheduled_at: Timestamp;
      status: "queued" | "sent" | "failed" | "skipped";
      sent_at: Timestamp | null;
      error: string | null;
      created_at: Timestamp;
    } & TrackingFields);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Schedule the Day-2 and Day-4 follow-ups for a freshly-submitted info
 * lead. Day-0 is sent inline by the demo route — these two land in the
 * scheduled_emails queue and get picked up by the cron.
 *
 * Idempotent on (recipient_email, step): if a row already exists with
 * status=queued or sent, we skip rescheduling.
 */
export async function scheduleInfoNurture(args: {
  recipientEmail: string;
  recipientName: string;
  clinicName: string;
  bookingUrl: string | null;
}): Promise<{ scheduled: number }> {
  void args.bookingUrl; // bookingUrl is read at send-time from env, not stored

  const steps: { step: NurtureStep; offsetDays: number }[] = [
    // First 5 days — concentrated value drip
    { step: "day_2", offsetDays: 2 },
    { step: "day_4", offsetDays: 4 },
    // Evergreen long tail — soft re-engagement so we never lose a lead
    { step: "day_14", offsetDays: 14 },
    { step: "day_30", offsetDays: 30 },
    { step: "day_60", offsetDays: 60 },
    { step: "day_90", offsetDays: 90 },
    { step: "day_180", offsetDays: 180 },
    { step: "day_365", offsetDays: 365 },
  ];

  let scheduled = 0;
  for (const s of steps) {
    const existing = await db()
      .collection("scheduled_emails")
      .where("recipient_email", "==", args.recipientEmail)
      .where("step", "==", s.step)
      .where("status", "in", ["queued", "sent"])
      .limit(1)
      .get();
    if (!existing.empty) continue;

    const scheduledAt = Timestamp.fromMillis(Date.now() + s.offsetDays * DAY_MS);
    await db().collection("scheduled_emails").add({
      type: "info_nurture",
      step: s.step,
      recipient_email: args.recipientEmail,
      recipient_name: args.recipientName,
      clinic_name: args.clinicName,
      scheduled_at: scheduledAt,
      status: "queued",
      sent_at: null,
      error: null,
      created_at: now(),
    });
    scheduled++;
  }
  return { scheduled };
}

/**
 * Find the next send_email step starting at fromIndex (inclusive), summing
 * any wait steps along the way into a delay-days total. Returns null if
 * no more send_email steps exist.
 */
export function findNextSendStep(
  steps: WorkflowStep[],
  fromIndex: number,
): { stepIndex: number; delayDays: number } | null {
  let delayDays = 0;
  for (let i = fromIndex; i < steps.length; i++) {
    const s = steps[i];
    if (s.action === "wait") {
      const d = Number(s.config?.days ?? 0);
      if (d > 0) delayDays += d;
      continue;
    }
    if (s.action === "send_email") {
      return { stepIndex: i, delayDays };
    }
    // Unknown step — skip
  }
  return null;
}

/**
 * Execute a single non-email side-effect step inline. apply_tag/remove_tag
 * mutate the contact; set_lead_status finds the most recent linked lead;
 * enroll_in_workflow recursively enrolls the contact in another workflow
 * (cycle-protected by the existing alreadyActive check); webhook POSTs.
 *
 * Note: side effects fire eagerly when the walker reaches them — i.e.,
 * immediately after the previous send completes, NOT delayed by any
 * intervening wait step. If you need a delayed side effect, put a send_email
 * step before it (so the wait is honored before the next send) or split into
 * two workflows chained via enroll_in_workflow.
 */
async function executeSideEffectStep(
  step: WorkflowStep,
  ctx: { contactId: string; enrollmentId: string; sourceWorkflowId: string },
): Promise<void> {
  try {
    if (step.action === "apply_tag") {
      const tag = String((step.config as { tag?: unknown }).tag ?? "").trim();
      if (!tag) return;
      const ref = db().collection("contacts").doc(ctx.contactId);
      await db().runTransaction(async (trx) => {
        const snap = await trx.get(ref);
        if (!snap.exists) return;
        const data = snap.data() as ContactDoc;
        const tags = Array.isArray(data.tags) ? data.tags : [];
        if (!tags.includes(tag)) trx.update(ref, { tags: [...tags, tag], updated_at: now() });
      });
      return;
    }

    if (step.action === "remove_tag") {
      const tag = String((step.config as { tag?: unknown }).tag ?? "").trim();
      if (!tag) return;
      const ref = db().collection("contacts").doc(ctx.contactId);
      await db().runTransaction(async (trx) => {
        const snap = await trx.get(ref);
        if (!snap.exists) return;
        const data = snap.data() as ContactDoc;
        const tags = Array.isArray(data.tags) ? data.tags.filter((t) => t !== tag) : [];
        trx.update(ref, { tags, updated_at: now() });
      });
      return;
    }

    if (step.action === "set_lead_status") {
      const status = String((step.config as { status?: unknown }).status ?? "").trim();
      if (!status) return;
      const leadSnap = await db()
        .collection("leads")
        .where("contact_id", "==", ctx.contactId)
        .orderBy("created_at", "desc")
        .limit(1)
        .get()
        .catch(() => null);
      if (leadSnap && !leadSnap.empty) {
        await leadSnap.docs[0].ref.update({ status, updated_at: now() });
      }
      return;
    }

    if (step.action === "enroll_in_workflow") {
      const targetId = String((step.config as { workflow_id?: unknown }).workflow_id ?? "").trim();
      if (!targetId || targetId === ctx.sourceWorkflowId) return;
      const { enrollContactInWorkflow } = await import("./workflows");
      await enrollContactInWorkflow({
        workflowId: targetId,
        contactId: ctx.contactId,
        source: { type: "manual" },
      });
      return;
    }

    if (step.action === "webhook") {
      const url = String((step.config as { url?: unknown }).url ?? "").trim();
      if (!url) return;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: ctx.contactId,
          enrollment_id: ctx.enrollmentId,
          workflow_id: ctx.sourceWorkflowId,
        }),
      }).catch(() => {});
      return;
    }

    // create_task → not yet implemented as a side effect; left for a future task-system pass
  } catch (err) {
    console.error(
      `[workflow-side-effect] action=${step.action} enrollment=${ctx.enrollmentId} failed`,
      err,
    );
  }
}

/**
 * Queue the next send_email step for a workflow enrollment. Idempotent on
 * (enrollment_id, step_index) — skips if a queued/sent row already exists.
 *
 * As it walks toward the next send_email, any non-wait/non-email steps
 * (apply_tag, set_lead_status, enroll_in_workflow, webhook) are executed
 * inline so they take effect at the right point in the sequence.
 */
export async function scheduleWorkflowStep(args: {
  workflowId: string;
  workflowSteps: WorkflowStep[];
  fromStepIndex: number;
  enrollmentId: string;
  contactId: string;
  recipientEmail: string;
  recipientName: string;
  clinicName: string;
}): Promise<{ scheduled: boolean; nextStepIndex?: number; sendInMs?: number }> {
  // Walk from fromStepIndex forward, executing side-effect steps inline.
  // Stop when we hit the next send_email step (capture its index + summed
  // delay) or run off the end of the array.
  let delayDays = 0;
  let nextStepIndex: number | null = null;
  for (let i = args.fromStepIndex; i < args.workflowSteps.length; i++) {
    const s = args.workflowSteps[i];
    if (s.action === "wait") {
      const d = Number(s.config?.days ?? 0);
      if (d > 0) delayDays += d;
      continue;
    }
    if (s.action === "send_email") {
      nextStepIndex = i;
      break;
    }
    await executeSideEffectStep(s, {
      contactId: args.contactId,
      enrollmentId: args.enrollmentId,
      sourceWorkflowId: args.workflowId,
    });
  }
  if (nextStepIndex === null) return { scheduled: false };
  const next = { stepIndex: nextStepIndex, delayDays };

  const existing = await db()
    .collection("scheduled_emails")
    .where("enrollment_id", "==", args.enrollmentId)
    .where("step_index", "==", next.stepIndex)
    .where("status", "in", ["queued", "sent"])
    .limit(1)
    .get()
    .catch(() => null);
  if (existing && !existing.empty) {
    return { scheduled: false, nextStepIndex: next.stepIndex };
  }

  const sendInMs = next.delayDays * DAY_MS;
  const scheduledAt = Timestamp.fromMillis(Date.now() + sendInMs);

  await db().collection("scheduled_emails").add({
    type: "workflow_step",
    workflow_id: args.workflowId,
    step_index: next.stepIndex,
    enrollment_id: args.enrollmentId,
    contact_id: args.contactId,
    recipient_email: args.recipientEmail,
    recipient_name: args.recipientName,
    clinic_name: args.clinicName,
    scheduled_at: scheduledAt,
    status: "queued",
    sent_at: null,
    error: null,
    created_at: now(),
  });

  return { scheduled: true, nextStepIndex: next.stepIndex, sendInMs };
}

/**
 * Send a single workflow-step email. Renders subject + body using the
 * workflow's step config + the contact's template vars. Returns ok|error.
 *
 * After a successful send the cron is responsible for:
 *   1. Marking the scheduled_emails row sent
 *   2. Calling scheduleWorkflowStep again with fromStepIndex=stepIndex+1
 *   3. If no more send_email steps, marking the enrollment completed
 */
export async function sendWorkflowStepEmail(args: {
  workflow: WorkflowDoc;
  stepIndex: number;
  contact: ContactDoc;
  /** scheduled_emails doc id — passed to Resend as a tag so webhook events can
   * find the row directly. Required for open/click tracking to attribute. */
  scheduledEmailId: string;
}): Promise<{ ok: boolean; error?: string; resendId?: string }> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { ok: false, error: "no_resend_key" };

  const step = args.workflow.steps?.[args.stepIndex];
  if (!step || step.action !== "send_email") {
    return { ok: false, error: "step_not_send_email" };
  }
  const cfg = step.config as Record<string, unknown>;
  const subject = String(cfg.subject ?? "").trim();
  const bodyHtml = String(cfg.body_html ?? "").trim();
  const bodyText = String(cfg.body_text ?? "").trim();
  const fromName = (cfg.from_name as string | undefined) || "Cory at Aesthera";
  if (!subject || !bodyHtml) return { ok: false, error: "step_empty" };

  const vars = templateVarsFromContact({
    contact: args.contact,
    senderName: fromName,
    senderEmail: process.env.PLATFORM_DEMO_NOTIFY_EMAIL || "person1@example.com",
  });
  const renderedSubject = renderTemplate(subject, vars);
  const renderedHtml = renderTemplate(bodyHtml, vars);
  const renderedText = bodyText ? renderTemplate(bodyText, vars) : undefined;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <noreply@${process.env.AESTHERA_EMAIL_DOMAIN || "aesthera.io"}>`,
      to: [args.contact.email],
      reply_to: process.env.PLATFORM_DEMO_NOTIFY_EMAIL || "person1@example.com",
      subject: renderedSubject,
      html: renderedHtml,
      ...(renderedText ? { text: renderedText } : {}),
      // Resend tags survive into webhook events as `data.tags` — use them
      // (not headers) for correlation. Tag values must be ASCII letters,
      // digits, _, or -. Firestore auto-IDs satisfy this.
      tags: [
        { name: "scheduled_email_id", value: args.scheduledEmailId },
        { name: "kind", value: "workflow_step" },
        {
          name: "workflow_id",
          value: (args.workflow as WorkflowDoc & { id?: string }).id ?? "unknown",
        },
        { name: "step_index", value: String(args.stepIndex) },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `${res.status} ${text.slice(0, 200)}` };
  }
  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  // Suppress lint about EMAIL_FROM unused in this function
  void EMAIL_FROM;
  return { ok: true, resendId: json?.id };
}

/**
 * Migration / catch-up: scan workflow_enrollments with status="active" for a
 * given workflow + queue step 0 for any that don't have a scheduled_emails
 * row yet. Returns the count of newly-scheduled rows.
 *
 * Idempotent: re-running is a no-op for already-scheduled enrollments.
 */
export async function backfillWorkflowEnrollments(workflowId: string): Promise<{
  enrollments: number;
  scheduled: number;
  skipped: number;
}> {
  const wfSnap = await db().collection("workflows").doc(workflowId).get();
  if (!wfSnap.exists) throw new Error(`Workflow ${workflowId} not found.`);
  const workflow = { ...(wfSnap.data() as WorkflowDoc), id: workflowId };
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];

  const enrSnap = await db()
    .collection("workflow_enrollments")
    .where("workflow_id", "==", workflowId)
    .where("status", "==", "active")
    .limit(1000)
    .get();

  let scheduled = 0;
  let skipped = 0;
  for (const d of enrSnap.docs) {
    const e = d.data() as WorkflowEnrollmentDoc;
    const fromStep = typeof e.current_step_index === "number" ? e.current_step_index : 0;
    const contactSnap = await db().collection("contacts").doc(e.contact_id).get();
    if (!contactSnap.exists) {
      skipped++;
      continue;
    }
    const contact = contactSnap.data() as ContactDoc;
    const r = await scheduleWorkflowStep({
      workflowId,
      workflowSteps: steps,
      fromStepIndex: fromStep,
      enrollmentId: d.id,
      contactId: e.contact_id,
      recipientEmail: contact.email,
      recipientName: contact.full_name || "there",
      clinicName: contact.company_name || "your clinic",
    });
    if (r.scheduled) scheduled++;
    else skipped++;
  }
  return { enrollments: enrSnap.size, scheduled, skipped };
}

/** Render and send one nurture email. */
export async function sendNurtureEmail(args: {
  step: NurtureStep;
  recipientEmail: string;
  recipientName: string;
  clinicName: string;
  scheduledEmailId: string;
}): Promise<{ ok: boolean; error?: string; resendId?: string }> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { ok: false, error: "no_resend_key" };

  const replyTo = process.env.PLATFORM_DEMO_NOTIFY_EMAIL || "person1@example.com";
  const bookingUrl =
    process.env.PLATFORM_DEMO_BOOKING_URL ||
    `${process.env.NEXT_PUBLIC_SITE_URL || "https://aesthera.io"}/#info`;
  const firstName = (args.recipientName.split(/\s+/)[0] || "there").trim();
  const subject = SUBJECTS[args.step];
  const html = renderHtml({ ...args, firstName, bookingUrl });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.support,
      to: [args.recipientEmail],
      reply_to: replyTo,
      subject,
      html,
      tags: [
        { name: "scheduled_email_id", value: args.scheduledEmailId },
        { name: "kind", value: "info_nurture" },
        { name: "step", value: args.step },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `${res.status} ${text.slice(0, 200)}` };
  }
  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  return { ok: true, resendId: json?.id };
}

const SUBJECTS: Record<NurtureStep, string> = {
  day_0: "How seven tools become one",
  day_2: "Where did you put the photo?",
  day_4: "AI that runs while your team sleeps",
  day_14: "Quick check-in — founding-25 spots are filling",
  day_30: "What we shipped this month for clinics like yours",
  day_60: "How one Utah clinic cut their admin hours in half",
  day_90: "Three things changing in med-spa software this quarter",
  day_180: "Six months later — want a fresh look at Aesthera?",
  day_365: "One year. New tools. Still building for clinics like yours.",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function shell(inner: string, bookingUrl: string): string {
  return `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#1b2636;line-height:1.6">
      ${inner}
      <p style="margin-top:32px;padding-top:20px;border-top:1px solid #e8dfc9;font-size:13px;color:#4a5568">
        Reply to this email and you reach me directly — Cory, the developer who built Aesthera.
        Or <a href="${bookingUrl}" style="color:#07667a;font-weight:600">book a 15-min call</a> any time.
      </p>
      <p style="font-size:11px;color:#888;margin-top:16px">
        Aesthera · MedSpa Management Software<br>
        <a href="https://aesthera.io/privacy" style="color:#888">Unsubscribe</a> · this is email 1–3 of an inbound info series. Reply STOP to halt.
      </p>
    </div>
  `;
}

function renderHtml(args: {
  step: NurtureStep;
  firstName: string;
  clinicName: string;
  bookingUrl: string;
}): string {
  const safeFirst = escapeHtml(args.firstName);
  const safeClinic = escapeHtml(args.clinicName);

  if (args.step === "day_0") {
    return shell(`
      <p>Hi ${safeFirst},</p>

      <p>I built Aesthera because I watched too many med-spa owners run their clinic with seven browser tabs open and a sticky note covered in passwords.</p>

      <p>Booking lives in Mindbody. Charting is on paper. Photos are on someone&apos;s iPhone. Marketing is in Mailchimp. Bookkeeping is in QuickBooks. Ads are in Meta. Reviews are in Birdeye. Each one solves a slice. None of them talk. Your front desk types the same client into four systems before lunch — and at the end of the month you still don&apos;t have a single number that tells you how the business is doing.</p>

      <p><strong>Aesthera does all seven, in one place.</strong> Same client record. One login. One source of truth. One number to call when something breaks — me.</p>

      <p>Two more emails coming over the next few days:</p>
      <ul style="line-height:1.85">
        <li><strong>Wednesday:</strong> the clinical side — charting, photos, consents</li>
        <li><strong>Friday:</strong> the growth side — AI marketing + Stripe + memberships</li>
      </ul>

      <p>If you&apos;d rather skip the reading and just see it run, the calendar&apos;s open:</p>

      <p style="margin:24px 0">
        <a href="${args.bookingUrl}" style="display:inline-block;padding:14px 28px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
          Book a 15-min call →
        </a>
      </p>

      <p>What I really want is to know what you&apos;re using today and where it falls down. Hit reply with one or two lines about ${safeClinic} — I read every one and I&apos;ll write back.</p>

      <p>— Cory</p>
    `, args.bookingUrl);
  }

  if (args.step === "day_2") {
    return shell(`
      <p>Hi ${safeFirst},</p>

      <p>Here&apos;s a question I ask every owner I talk to:</p>

      <p style="background:#fdf9f3;border-left:3px solid #b98f42;padding:14px 16px;border-radius:6px;margin:16px 0">
        It&apos;s a Tuesday at 11. Your patient from three months ago walks in for a follow-up. Where is the before photo? Where is the consent form they signed last time? Where are the notes from the last visit?
      </p>

      <p>The answer I usually get is some combination of: &quot;the iPad in room 2,&quot; &quot;the binder upstairs,&quot; &quot;email me, I&apos;ll find it,&quot; or &quot;let me check Sarah&apos;s phone.&quot;</p>

      <p>In Aesthera, all three are on the chart. Visible the moment the appointment opens. Photo is paired before/after with annotation, consent is signed digitally and PDF&apos;d to the chart, prior notes auto-fill the SOAP draft for this visit. Provider clicks <em>Generate AI draft</em> and gets a structured Subjective / Objective / Assessment / Plan in about 1.4 seconds — they review, edit any field, sign. Total time from sit-down to chart-signed: under 90 seconds.</p>

      <p>I built this part of the platform first because it&apos;s the part I see broken most. Paper consents are an audit risk. Phone-camera photos are a HIPAA violation waiting to happen. SOAP notes that take 15 minutes per patient burn provider hours that should go to seeing more clients.</p>

      <p><strong>The AI never auto-saves and never auto-signs.</strong> Every chart is human-reviewed and signed by the provider. The AI is a starting point, not a shortcut around the licensed clinician.</p>

      <p>If you want to see what your charting looks like in Aesthera with a live walkthrough — pick a slot, I&apos;ll screen-share for 15 minutes:</p>

      <p style="margin:24px 0">
        <a href="${args.bookingUrl}" style="display:inline-block;padding:14px 28px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
          Book a charting walkthrough →
        </a>
      </p>

      <p>Or hit reply and tell me how ${safeClinic} handles charting today — I&apos;ll send you the specific module of Aesthera that replaces it.</p>

      <p>— Cory</p>
    `, args.bookingUrl);
  }

  if (args.step === "day_14") {
    return shell(`
      <p>Hi ${safeFirst},</p>

      <p>Quick check-in — it's been a couple weeks since you grabbed the info series, so I figured I'd see where you landed.</p>

      <p>Three things worth knowing:</p>

      <ol style="line-height:1.85">
        <li><strong>Founding-25 spots are filling.</strong> When they're gone, the $99/mo lifetime rate retires permanently.</li>
        <li><strong>White-glove onboarding</strong> covers everything end-to-end — Stripe Connect wired, Twilio number provisioned, all your socials linked, data migrated, training included. $1,500 one-time, 48-hour delivery.</li>
        <li>I&apos;ve had ${safeClinic} on my mind since you signed up. If there&apos;s a specific objection or constraint, I want to hear it. The roadmap genuinely shifts based on what founding clinics tell me.</li>
      </ol>

      <p>If you want to see a quick demo or just ask a question, I&apos;m one click away:</p>

      <p style="margin:24px 0">
        <a href="${args.bookingUrl}" style="display:inline-block;padding:14px 28px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
          Book 15 min →
        </a>
      </p>

      <p>If now isn&apos;t the right time, no pressure. I&apos;ll keep you posted as we ship — short emails, useful only.</p>

      <p>— Cory</p>
    `, args.bookingUrl);
  }

  if (args.step === "day_30") {
    return shell(`
      <p>Hi ${safeFirst},</p>

      <p>Roughly a month since you joined the info list. Quick update on what shipped for clinics like ${safeClinic} since:</p>

      <ul style="line-height:1.85">
        <li><strong>Stripe Connect (V2)</strong> — clinics can now accept patient payments without leaving the platform. Memberships auto-renew. Tips, gift cards, package redemptions all flow through one ledger.</li>
        <li><strong>Two-way SMS inbox</strong> — your front desk handles client messages from inside Aesthera. No more &quot;text Sarah&apos;s personal phone.&quot;</li>
        <li><strong>Photos with HIPAA-safe markup</strong> — capture, annotate, pair before/after, scoped to the chart. iPhone camera roll problem, solved.</li>
        <li><strong>AI SOAP draft</strong> — under 1.5 seconds from click to filled chart. Provider reviews, edits, signs.</li>
      </ul>

      <p>None of this is theoretical — it&apos;s all live in the platform today. The founding-25 spots that lock $99/mo for life are still open if you want a permanent rate before the gate closes.</p>

      <p style="margin:24px 0">
        <a href="${args.bookingUrl}" style="display:inline-block;padding:14px 28px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
          See it in 15 min →
        </a>
      </p>

      <p>Reply with a single line if you have a specific question about how it&apos;d fit ${safeClinic}. I read every reply.</p>

      <p>— Cory</p>
    `, args.bookingUrl);
  }

  if (args.step === "day_60") {
    return shell(`
      <p>Hi ${safeFirst},</p>

      <p>One pattern I&apos;ve been seeing across the clinics that adopt Aesthera early:</p>

      <p style="background:#fdf9f3;border-left:3px solid #b98f42;padding:14px 16px;border-radius:6px;margin:16px 0">
        <strong>Owner hours on admin work drop 40–60% in the first month.</strong>
      </p>

      <p>Not because anything magical happens — but because seven tools become one. The owner stops being the integration glue between Mindbody, paper charts, the iPhone camera, Mailchimp, and QuickBooks. The platform IS the integration.</p>

      <p>Most owners I talk to spend 8–12 hours a week on admin. After Aesthera, that&apos;s 3–5 hours. That&apos;s a half-day a week back — that&apos;s an extra patient day a month, or just a real weekend.</p>

      <p>If ${safeClinic} is in that 8+ hours/week zone, this is the conversation worth having:</p>

      <p style="margin:24px 0">
        <a href="${args.bookingUrl}" style="display:inline-block;padding:14px 28px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
          Walk me through ${safeClinic} →
        </a>
      </p>

      <p>I&apos;ll keep these emails short and a few weeks apart from here. If now is&apos;t right, I&apos;ll be here when it is.</p>

      <p>— Cory</p>
    `, args.bookingUrl);
  }

  if (args.step === "day_90") {
    return shell(`
      <p>Hi ${safeFirst},</p>

      <p>Three months in. Quick state-of-the-industry rundown — three things changing in med-spa software this quarter:</p>

      <ol style="line-height:1.85">
        <li><strong>HIPAA enforcement is up.</strong> OCR audits hit aesthetic clinics in 2025 in a way they didn&apos;t before. iPhone camera rolls, paper consents, and shared spreadsheets all carry risk now. The clinics that proactively migrated are no longer worried.</li>
        <li><strong>AI charting moved from gimmick to standard.</strong> The clinics that resisted it for &quot;quality&quot; reasons are realizing the AI draft is faster AND more thorough than the rushed handwritten note. Provider reviews, AI doesn&apos;t replace.</li>
        <li><strong>Stripe Connect is the new default.</strong> Owners who used to send PayPal links and Venmo requests now have memberships, packages, and tips flowing through one ledger. The bookkeeping side gets quieter.</li>
      </ol>

      <p>Aesthera covers all three out of the box. If you&apos;re still on a stack that pre-dates these shifts, the migration cost gets bigger every month you wait — your client list grows, the data debt grows, the staff training grows.</p>

      <p style="margin:24px 0">
        <a href="${args.bookingUrl}" style="display:inline-block;padding:14px 28px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
          15-min walkthrough →
        </a>
      </p>

      <p>— Cory</p>
    `, args.bookingUrl);
  }

  if (args.step === "day_180") {
    return shell(`
      <p>Hi ${safeFirst},</p>

      <p>It&apos;s been six months. Things change in six months — your stack, your team, your priorities, what your clinic looks like.</p>

      <p>Aesthera has changed too. We&apos;re live with founding clinics, the platform is shipping new features every couple weeks, and the whole experience is sharper than what you saw in the first emails.</p>

      <p>If you bookmarked this and meant to come back, here&apos;s your cue. A 15-minute walkthrough — fresh look, no pressure:</p>

      <p style="margin:24px 0">
        <a href="${args.bookingUrl}" style="display:inline-block;padding:14px 28px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
          Take a fresh look →
        </a>
      </p>

      <p>If you&apos;ve already chosen something else, no problem — reply &quot;done&quot; and I&apos;ll stop reaching out. Otherwise I&apos;ll catch you in a few months.</p>

      <p>— Cory</p>
    `, args.bookingUrl);
  }

  if (args.step === "day_365") {
    return shell(`
      <p>Hi ${safeFirst},</p>

      <p>One year ago you grabbed the Aesthera info series. I figured I&apos;d close the loop.</p>

      <p>If you&apos;re still on a patchwork stack — the same seven tools — and ${safeClinic} is humming along OK with it, no judgment. Plenty of clinics do.</p>

      <p>If those seven tools are quietly costing you more than they save in admin hours, in lost clients to friction, in compliance risk — that&apos;s the reason I built Aesthera and the reason I keep building it. The clinics that switched a year ago are not switching back.</p>

      <p>Same offer, fresh year:</p>

      <p style="margin:24px 0">
        <a href="${args.bookingUrl}" style="display:inline-block;padding:14px 28px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
          Book a 15-min look →
        </a>
      </p>

      <p>This is the last note unless you reach back out. Either way — thanks for the year of letting me into your inbox.</p>

      <p>— Cory</p>
    `, args.bookingUrl);
  }

  // day_4 (the original "AI marketing" close)
  return shell(`
    <p>Hi ${safeFirst},</p>

    <p>Last one. Then I leave you alone unless you ask.</p>

    <p>Most med-spa platforms stop at booking and charting. Aesthera doesn&apos;t — because the clinics that win at this aren&apos;t the ones with the prettiest scheduling UI. They&apos;re the ones whose marketing runs on its own.</p>

    <p>Five behavioral triggers ship built-in:</p>
    <ul style="line-height:1.85">
      <li><strong>Birthday week</strong> — celebrate them with a personalized incentive</li>
      <li><strong>Post-treatment 21-day</strong> — &quot;how are you feeling? here&apos;s what to expect&quot;</li>
      <li><strong>Reactivation 90-day</strong> — pull lapsed clients back without the front desk lifting a finger</li>
      <li><strong>Welcome new client</strong> — onboarding sequence to drive a second visit</li>
      <li><strong>Upsell post-visit 3-7 day</strong> — recommend the right next service based on what they just got</li>
    </ul>

    <p>For each one, AI drafts a personal message based on the client&apos;s history. You review the first email of the batch, click send, and the rest fire automatically — birthday emails for the next 12 months, post-treatment follow-ups for everyone who hits 21 days, and so on.</p>

    <p>Add Stripe Connect on top. Clients pay deposits at booking. Memberships auto-renew without manual chasing. Tips, gift cards, package redemptions — all in the platform. Money lands in the clinic&apos;s own Stripe account; Aesthera takes a small platform fee on Growth+ tiers (zero on Founding-25).</p>

    <p>Founding-25 spots are still open today, but won&apos;t be for long. <strong>$99/month for life</strong> for everything you&apos;d normally pay $399 for, locked as long as you stay a customer.</p>

    <p style="margin:24px 0">
      <a href="${args.bookingUrl}" style="display:inline-block;padding:14px 28px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:10px;font-weight:600;letter-spacing:0.02em">
        Lock in a founding-25 spot — book 15 min →
      </a>
    </p>

    <p>If now isn&apos;t the right time, that&apos;s OK — these emails stop here. Reply when it is and we pick up where we left off.</p>

    <p>Either way, thanks for taking the time. I built Aesthera because I genuinely care about the clinics that use it. Your business deserves better software than seven disconnected tabs.</p>

    <p>— Cory</p>
  `, args.bookingUrl);
}
