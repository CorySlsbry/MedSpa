/**
 * POST /api/system/cron/scheduled-emails
 *
 * Hourly cron — pulls scheduled_emails docs whose scheduled_at <= now
 * and status === "queued", sends them, marks status. Idempotent + bounded
 * by a per-run cap so a transient Resend outage doesn't pile up.
 *
 * Cloud Scheduler job (created separately):
 *   medspa-scheduled-emails — `0 * * * *` UTC, POST to this endpoint with
 *   x-aesthera-cron-key header set to CRON_SHARED_SECRET.
 */

import { NextResponse } from "next/server";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { authorizeCron } from "@/lib/cron-auth";
import {
  sendNurtureEmail,
  sendWorkflowStepEmail,
  scheduleWorkflowStep,
  type ScheduledEmailDoc,
} from "@/lib/nurture";
import type { ContactDoc, WorkflowDoc, WorkflowEnrollmentDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_RUN = 100;

export async function POST(req: Request) {
  const auth = authorizeCron(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const dueSnap = await db()
      .collection("scheduled_emails")
      .where("status", "==", "queued")
      .where("scheduled_at", "<=", Timestamp.now())
      .orderBy("scheduled_at", "asc")
      .limit(MAX_PER_RUN)
      .get();

    for (const d of dueSnap.docs) {
      processed++;
      const e = d.data() as ScheduledEmailDoc;

      // Skip nurture sends for super-admin emails (defense in depth — admin
      // shouldn't be in the inbound nurture list, but if a row leaked in,
      // mark it skipped instead of sending).
      const allow = (process.env.ADMIN_BOOTSTRAP_EMAIL || "")
        .toLowerCase()
        .split(",")
        .map((s) => s.trim());
      if (allow.includes(e.recipient_email.toLowerCase())) {
        await d.ref.update({
          status: "skipped",
          error: "admin_email",
          updated_at: now(),
        });
        skipped++;
        continue;
      }

      if (e.type === "info_nurture") {
        const result = await sendNurtureEmail({
          step: e.step,
          recipientEmail: e.recipient_email,
          recipientName: e.recipient_name,
          clinicName: e.clinic_name,
          scheduledEmailId: d.id,
        });
        if (result.ok) {
          await d.ref.update({
            status: "sent",
            sent_at: now(),
            error: null,
            resend_id: result.resendId ?? null,
          });
          sent++;
        } else {
          await d.ref.update({ status: "failed", error: result.error ?? "unknown" });
          failed++;
        }
        continue;
      }

      if (e.type === "workflow_step") {
        // Re-fetch the workflow + contact at send-time so any edits made
        // by Cory in /admin/workflows are reflected in what actually goes out.
        const wfSnap = await db().collection("workflows").doc(e.workflow_id).get();
        const ctSnap = await db().collection("contacts").doc(e.contact_id).get();
        if (!wfSnap.exists || !ctSnap.exists) {
          await d.ref.update({ status: "skipped", error: "workflow_or_contact_missing" });
          skipped++;
          continue;
        }
        const workflow = { ...(wfSnap.data() as WorkflowDoc), id: e.workflow_id };
        const contact = ctSnap.data() as ContactDoc;

        // Bail if the contact got DND-flagged between scheduling and send
        if (contact.do_not_contact || contact.email_unsubscribed) {
          await d.ref.update({ status: "skipped", error: "contact_dnd" });
          skipped++;
          continue;
        }

        const result = await sendWorkflowStepEmail({
          workflow,
          stepIndex: e.step_index,
          contact,
          scheduledEmailId: d.id,
        });
        if (result.ok) {
          await d.ref.update({
            status: "sent",
            sent_at: now(),
            error: null,
            resend_id: result.resendId ?? null,
          });
          sent++;
          // Update enrollment.current_step_index to this step + queue next
          const enrollRef = db().collection("workflow_enrollments").doc(e.enrollment_id);
          const enrSnap = await enrollRef.get();
          if (enrSnap.exists) {
            const enr = enrSnap.data() as WorkflowEnrollmentDoc;
            // Advance to the step AFTER the just-completed send. The panel
            // interprets current_step_index as "next step to process" — i.e.,
            // if step 0 (a send) just fired and step 1 is a wait, idx=1 means
            // "in the wait", which matches what the operator sees in the UI.
            await enrollRef.update({
              current_step_index: e.step_index + 1,
              last_step_at: now(),
            });
            const next = await scheduleWorkflowStep({
              workflowId: e.workflow_id,
              workflowSteps: Array.isArray(workflow.steps) ? workflow.steps : [],
              fromStepIndex: e.step_index + 1,
              enrollmentId: e.enrollment_id,
              contactId: e.contact_id,
              recipientEmail: contact.email,
              recipientName: contact.full_name || "there",
              clinicName: contact.company_name || "your clinic",
            });
            if (!next.scheduled) {
              // No more send_email steps — mark enrollment completed
              await enrollRef.update({
                status: "completed",
                completed_at: now(),
              });
              await db().collection("workflows").doc(e.workflow_id).update({
                active_enrollments: FieldValue.increment(-1),
                updated_at: now(),
              });
              void enr; // keep var referenced
            }
          }
        } else {
          await d.ref.update({ status: "failed", error: result.error ?? "unknown" });
          failed++;
        }
        continue;
      }

      // Unknown type — mark and move on
      await d.ref.update({
        status: "skipped",
        error: `unknown_type:${(e as { type?: string }).type ?? "?"}`,
      });
      skipped++;
    }
  } catch (err) {
    console.error("[scheduled-emails] cron failed", err);
    return NextResponse.json({ error: "Cron handler error." }, { status: 500 });
  }

  console.log(
    JSON.stringify({
      event: "scheduled_emails_run",
      processed,
      sent,
      failed,
      skipped,
      ts: new Date().toISOString(),
    }),
  );
  return NextResponse.json({ ok: true, processed, sent, failed, skipped });
}
