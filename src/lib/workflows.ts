/**
 * Workflow engine — server-side orchestration for the Aesthera platform
 * super-admin CRM. Modeled on the salisburybookkeeping.com /admin/workflows
 * UX patterns but Firestore-native, with no shared data or infra.
 *
 * Concept: a workflow has a trigger (tag, lead-created, manual) and a
 * sequence of steps (apply_tag, send_email, wait, set_status). Enrolling a
 * contact creates a WorkflowEnrollmentDoc that tracks progress through the
 * steps. For the MVP we only need:
 *   1. Apply the workflow's brand tag to the contact (drives external
 *      email-send infra via that tag).
 *   2. Log the enrollment as an activity on the source lead.
 *   3. Bump active_enrollments + total_enrollments counters atomically.
 *
 * The full step runner (wait → next step → fire action) is a placeholder
 * here; the immediate brand-tag side effect happens at enroll time so the
 * lead is "in" the funnel from the click.
 */

import { Timestamp, FieldValue, type Transaction } from "firebase-admin/firestore";
import { db, now } from "./firestore";
import { writeAuditInTx } from "./audit";
import type {
  ContactDoc,
  LeadDoc,
  WorkflowDoc,
  WorkflowEnrollmentDoc,
  WorkflowStep,
} from "./firestore-types";

const DAY_MS = 24 * 60 * 60 * 1000;

export type EnrollSource =
  | { type: "lead"; leadId: string }
  | { type: "deal"; dealId: string }
  | { type: "manual" };

export type EnrollResult =
  | { ok: true; enrollmentId: string; alreadyActive: false }
  | { ok: true; enrollmentId: string; alreadyActive: true }
  | { ok: false; reason: "workflow_not_found" | "workflow_inactive" | "contact_not_found" | "cooldown" | "already_active" };

/**
 * Enroll a contact in a workflow. Idempotent: if the contact is currently
 * active in the same workflow, returns alreadyActive=true. Cooldown is
 * enforced against the most recent enrollment of any status.
 */
export async function enrollContactInWorkflow(args: {
  workflowId: string;
  contactId: string; // doc id (lowercased email per ContactDoc convention)
  source: EnrollSource;
  actorUserId?: string | null;
  actorEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<EnrollResult> {
  const txResult: EnrollResult = await db().runTransaction(async (trx): Promise<EnrollResult> => {
    const wfRef = db().collection("workflows").doc(args.workflowId);
    const cliRef = db().collection("contacts").doc(args.contactId);
    const [wfSnap, cliSnap] = await Promise.all([trx.get(wfRef), trx.get(cliRef)]);
    if (!wfSnap.exists) return { ok: false, reason: "workflow_not_found" };
    if (!cliSnap.exists) return { ok: false, reason: "contact_not_found" };

    const wf = wfSnap.data() as WorkflowDoc;
    const cli = cliSnap.data() as ContactDoc;
    if (wf.status !== "active") return { ok: false, reason: "workflow_inactive" };

    // Cooldown check
    if ((wf.cooldown_days ?? 0) > 0) {
      const cutoff = Timestamp.fromMillis(Date.now() - wf.cooldown_days * DAY_MS);
      const recent = await trx.get(
        db()
          .collection("workflow_enrollments")
          .where("workflow_id", "==", args.workflowId)
          .where("contact_id", "==", args.contactId)
          .where("enrolled_at", ">=", cutoff)
          .limit(1),
      );
      if (!recent.empty) return { ok: false, reason: "cooldown" };
    }

    // Already-active check
    const existing = await trx.get(
      db()
        .collection("workflow_enrollments")
        .where("workflow_id", "==", args.workflowId)
        .where("contact_id", "==", args.contactId)
        .where("status", "==", "active")
        .limit(1),
    );
    if (!existing.empty) {
      return { ok: true, enrollmentId: existing.docs[0].id, alreadyActive: true };
    }

    // Apply the trigger tag immediately (so external email-runner picks
    // it up). Build the new tags array dedup'd.
    const triggerTag = String(wf.trigger_config.tag ?? "").trim();
    if (triggerTag) {
      const tags = Array.isArray(cli.tags) ? cli.tags : [];
      if (!tags.includes(triggerTag)) {
        trx.update(cliRef, {
          tags: [...tags, triggerTag],
          updated_at: now(),
        });
      }
    }

    // Run any apply_tag steps inline for simple flows (defensive: also
    // handles workflows where trigger is "manual" but the steps apply tags).
    const additionalTags = applyTagSteps(wf.steps);
    if (additionalTags.length > 0) {
      const merged = mergeTags(cli.tags ?? [], additionalTags, [triggerTag]);
      trx.update(cliRef, { tags: merged, updated_at: now() });
    }

    // Insert the enrollment doc
    const enrollRef = db().collection("workflow_enrollments").doc();
    const sourceType: WorkflowEnrollmentDoc["source_type"] =
      args.source.type === "lead" ? "lead" : args.source.type === "deal" ? "deal" : "manual";
    const sourceId =
      args.source.type === "lead" ? args.source.leadId : args.source.type === "deal" ? args.source.dealId : null;

    const doc: Omit<WorkflowEnrollmentDoc, "enrolled_at"> & {
      enrolled_at: ReturnType<typeof now>;
    } = {
      workflow_id: args.workflowId,
      workflow_name: wf.name,
      contact_id: args.contactId,
      contact_email: cli.email,
      current_step_index: 0,
      status: "active",
      enrolled_at: now(),
      next_run_at: nextRunAt(wf.steps, 0),
      last_step_at: null,
      completed_at: null,
      last_error: null,
      source_type: sourceType,
      source_id: sourceId,
      enrolled_by_user_id: args.actorUserId ?? null,
    };
    trx.create(enrollRef, doc);

    // Counters
    trx.update(wfRef, {
      active_enrollments: FieldValue.increment(1),
      total_enrollments: FieldValue.increment(1),
      updated_at: now(),
    });

    // Activity on the source lead, if any
    if (args.source.type === "lead") {
      const actRef = db().collection("activities").doc();
      trx.create(actRef, {
        contact_id: args.contactId,
        company_id: null,
        lead_id: args.source.leadId,
        deal_id: null,
        type: "system",
        summary: `Enrolled in workflow: ${wf.name}`,
        details: { workflow_id: args.workflowId, enrollment_id: enrollRef.id, trigger_tag: triggerTag || null },
        created_by: args.actorUserId ?? null,
        occurred_at: now(),
        created_at: now(),
      });
    }

    writeAuditInTx(trx, {
      action: "admin.user_create",
      actorUserId: args.actorUserId ?? null,
      actorEmail: args.actorEmail ?? null,
      targetType: "workflow.enrollment",
      targetId: enrollRef.id,
      after: {
        workflow_id: args.workflowId,
        workflow_name: wf.name,
        contact_id: args.contactId,
        source_type: sourceType,
        source_id: sourceId,
      },
      ip: args.ip ?? null,
      userAgent: args.userAgent ?? null,
    });

    return { ok: true, enrollmentId: enrollRef.id, alreadyActive: false };
  });

  // Post-transaction: queue the first send_email step in scheduled_emails
  // so the cron picks it up. Done outside the tx — failure here doesn't
  // roll back the enrollment, just logs.
  if (txResult.ok && !txResult.alreadyActive) {
    try {
      const wfDoc = await db().collection("workflows").doc(args.workflowId).get();
      const ctDoc = await db().collection("contacts").doc(args.contactId).get();
      if (wfDoc.exists && ctDoc.exists) {
        const wf = wfDoc.data() as WorkflowDoc;
        const cli = ctDoc.data() as ContactDoc;
        const { scheduleWorkflowStep } = await import("./nurture");
        await scheduleWorkflowStep({
          workflowId: args.workflowId,
          workflowSteps: Array.isArray(wf.steps) ? wf.steps : [],
          fromStepIndex: 0,
          enrollmentId: txResult.enrollmentId,
          contactId: args.contactId,
          recipientEmail: cli.email,
          recipientName: cli.full_name || "there",
          clinicName: cli.company_name || "your clinic",
        });
      }
    } catch (err) {
      console.error("[workflows] schedule step 0 failed", err);
    }
  }

  return txResult;
}

/**
 * Exit (un-enroll) a contact from any active enrollment in a workflow.
 * Removes the brand trigger tag from the contact too. Returns the count
 * of enrollments exited.
 */
export async function exitContactFromWorkflow(args: {
  workflowId: string;
  contactId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  reason?: string;
}): Promise<{ exited: number }> {
  return db().runTransaction(async (trx) => {
    const wfRef = db().collection("workflows").doc(args.workflowId);
    const cliRef = db().collection("contacts").doc(args.contactId);
    const [wfSnap, cliSnap, activeSnap] = await Promise.all([
      trx.get(wfRef),
      trx.get(cliRef),
      trx.get(
        db()
          .collection("workflow_enrollments")
          .where("workflow_id", "==", args.workflowId)
          .where("contact_id", "==", args.contactId)
          .where("status", "==", "active")
          .limit(20),
      ),
    ]);
    if (!wfSnap.exists || !cliSnap.exists) return { exited: 0 };
    const wf = wfSnap.data() as WorkflowDoc;
    const cli = cliSnap.data() as ContactDoc;

    let count = 0;
    for (const d of activeSnap.docs) {
      trx.update(d.ref, {
        status: "exited",
        completed_at: now(),
        last_error: args.reason ?? null,
      });
      count++;
    }
    if (count > 0) {
      trx.update(wfRef, {
        active_enrollments: FieldValue.increment(-count),
        updated_at: now(),
      });
    }

    // Remove the trigger tag from the contact
    const triggerTag = String(wf.trigger_config.tag ?? "").trim();
    if (triggerTag && Array.isArray(cli.tags) && cli.tags.includes(triggerTag)) {
      trx.update(cliRef, {
        tags: cli.tags.filter((t: string) => t !== triggerTag),
        updated_at: now(),
      });
    }

    if (count > 0) {
      writeAuditInTx(trx, {
        action: "admin.user_suspend",
        actorUserId: args.actorUserId ?? null,
        actorEmail: args.actorEmail ?? null,
        targetType: "workflow.enrollment_exit",
        targetId: args.contactId,
        after: { workflow_id: args.workflowId, exited: count, reason: args.reason ?? null },
      });
    }

    return { exited: count };
  });
}

function applyTagSteps(steps: WorkflowStep[] | undefined): string[] {
  if (!Array.isArray(steps)) return [];
  const tags: string[] = [];
  for (const s of steps) {
    if (s.action === "apply_tag" && typeof s.config?.tag === "string") {
      tags.push(s.config.tag);
    }
  }
  return tags;
}

function mergeTags(existing: string[], add: string[], also: string[]): string[] {
  const set = new Set<string>(existing);
  for (const t of add) if (t) set.add(t);
  for (const t of also) if (t) set.add(t);
  return Array.from(set);
}

function nextRunAt(steps: WorkflowStep[] | undefined, idx: number): Timestamp | null {
  const step = steps?.[idx];
  if (!step) return null;
  if (step.action === "wait") {
    const days = Number(step.config?.days ?? 0);
    if (days > 0) return Timestamp.fromMillis(Date.now() + days * DAY_MS);
  }
  // For non-wait steps, the runner picks them up immediately on its next pass.
  return Timestamp.now();
}

// Keep `Transaction` referenced for the public type chain even if not used directly.
export type { Transaction };

/** Convenience: lead → contact resolver for the lead-detail enrollment endpoint. */
export async function contactIdForLead(leadId: string): Promise<string | null> {
  const snap = await db().collection("leads").doc(leadId).get();
  if (!snap.exists) return null;
  const lead = snap.data() as LeadDoc;
  return lead.contact_id ?? lead.contact?.email?.toLowerCase() ?? null;
}

// ── Template variable substitution ─────────────────────────────────────────

/**
 * Variables available in send_email step subject/body templates.
 * Resolved at send time from the enrolled contact + linked company.
 *
 * Syntax: {{first_name}}, {{company_name}}, etc. Missing values fall
 * back to the configured default (or the empty string if no default).
 *
 * Sender note: keep this list small + stable. Each new variable is a
 * permanent contract with everyone authoring templates.
 */
export type TemplateVars = {
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  company_name: string;
  city: string;
  state: string;
  /** The clinic's website if known. */
  website: string;
  /** Sender's name + email — pulled from the workflow's from_name / from_email. */
  sender_name: string;
  sender_email: string;
};

const DEFAULTS: TemplateVars = {
  first_name: "there",
  last_name: "",
  full_name: "there",
  email: "",
  company_name: "your clinic",
  city: "",
  state: "",
  website: "",
  sender_name: "Cory at Aesthera",
  sender_email: "cory.salisbury@gmail.com",
};

/** Render a template by substituting {{var_name}} placeholders. */
export function renderTemplate(template: string, vars: Partial<TemplateVars>): string {
  if (!template) return "";
  const merged: TemplateVars = { ...DEFAULTS, ...vars };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, name: string) => {
    const key = name.trim().toLowerCase() as keyof TemplateVars;
    const v = merged[key];
    return v === undefined ? "" : String(v);
  });
}

/** Pull TemplateVars from a contact doc (and the lead's company snapshot if present). */
export function templateVarsFromContact(args: {
  contact: ContactDoc;
  lead?: LeadDoc | null;
  senderName?: string;
  senderEmail?: string;
}): TemplateVars {
  const fullName = args.contact.full_name?.trim() || "";
  const [first, ...rest] = fullName ? fullName.split(/\s+/) : [];
  const companyName = args.lead?.company?.name || args.contact.company_name || "";
  return {
    first_name: first || "there",
    last_name: rest.join(" "),
    full_name: fullName || "there",
    email: args.contact.email,
    company_name: companyName || "your clinic",
    city: args.lead?.company ? (args.lead.company as { location_city?: string }).location_city || "" : "",
    state: args.lead?.company ? (args.lead.company as { location_state?: string }).location_state || "" : "",
    website: args.lead?.company ? (args.lead.company as { website?: string }).website || "" : "",
    sender_name: args.senderName || DEFAULTS.sender_name,
    sender_email: args.senderEmail || DEFAULTS.sender_email,
  };
}

/** Variables available — exposed to the editor UI as a picker. */
export const TEMPLATE_VAR_DOCS: { key: keyof TemplateVars; description: string; example: string }[] = [
  { key: "first_name", description: "Contact's first name", example: "Sarah" },
  { key: "last_name", description: "Contact's last name", example: "Roberts" },
  { key: "full_name", description: "Contact's full name", example: "Sarah Roberts" },
  { key: "email", description: "Contact's email", example: "person1@example.com" },
  { key: "company_name", description: "Clinic name", example: "Park City Aesthetics" },
  { key: "city", description: "Clinic city", example: "Park City" },
  { key: "state", description: "Clinic state", example: "UT" },
  { key: "website", description: "Clinic website", example: "https://parkcityaesthetics.com" },
  { key: "sender_name", description: "Your name (workflow setting)", example: "Cory at Aesthera" },
  { key: "sender_email", description: "Your email (workflow setting)", example: "person2@example.com" },
];
