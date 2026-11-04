/**
 * Resolve the "current workflow" for a lead — the most recent active
 * enrollment by contact_id (= email). Used by /match + GET /leads to
 * surface current_workflow_id / _name / band / status to Jarvis so it
 * can decide whether the lead is mid-nurture or eligible for a fresh
 * push.
 *
 * Band heuristic: workflow names that include "short" → "short", names
 * including "long" → "long", otherwise null. Adjust if Aesthera adds
 * other named bands in the future.
 */

import { db } from "./firestore";
import type { WorkflowEnrollmentDoc } from "./firestore-types";

export type CurrentWorkflowSummary = {
  current_workflow_id: string | null;
  current_workflow_name: string | null;
  current_band: "short" | "long" | null;
};

export async function loadCurrentWorkflow(
  contactEmail: string,
): Promise<CurrentWorkflowSummary> {
  const snap = await db()
    .collection("workflow_enrollments")
    .where("contact_email", "==", contactEmail)
    .where("status", "==", "active")
    .orderBy("enrolled_at", "desc")
    .limit(1)
    .get()
    .catch(() => null);

  if (!snap || snap.empty) {
    return { current_workflow_id: null, current_workflow_name: null, current_band: null };
  }

  const enr = snap.docs[0].data() as WorkflowEnrollmentDoc;
  const name = enr.workflow_name ?? "";
  const lower = name.toLowerCase();
  const band: "short" | "long" | null = lower.includes("short")
    ? "short"
    : lower.includes("long")
      ? "long"
      : null;
  return {
    current_workflow_id: enr.workflow_id,
    current_workflow_name: name,
    current_band: band,
  };
}
