/**
 * One-shot backfill: advance workflow_enrollments.current_step_index past
 * the highest "sent" step in scheduled_emails for each enrollment.
 *
 * Why: prior cron logic set current_step_index = e.step_index after a send,
 * which means an enrollment whose step-0 email already fired still reads
 * idx=0 ("at step 1" in the UI 1-indexed). The new cron uses idx+1 so the
 * panel reflects "post-step-0, in the wait." This script repairs in-flight
 * enrollments so the UI updates without waiting for the next send.
 *
 * Idempotent: if an enrollment's current_step_index is already past the
 * highest sent step, leaves it alone.
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault(), projectId: "medspa-494718" });
const db = getFirestore();

const enrSnap = await db
  .collection("workflow_enrollments")
  .where("status", "==", "active")
  .limit(5000)
  .get();

let advanced = 0;
let untouched = 0;

for (const d of enrSnap.docs) {
  const enr = d.data();
  const sentSnap = await db
    .collection("scheduled_emails")
    .where("enrollment_id", "==", d.id)
    .where("status", "==", "sent")
    .get();

  if (sentSnap.empty) {
    untouched++;
    continue;
  }

  let maxSentStep = -1;
  for (const s of sentSnap.docs) {
    const idx = s.data().step_index;
    if (typeof idx === "number" && idx > maxSentStep) maxSentStep = idx;
  }
  const target = maxSentStep + 1;
  const current = typeof enr.current_step_index === "number" ? enr.current_step_index : 0;

  if (target > current) {
    await d.ref.update({ current_step_index: target });
    advanced++;
  } else {
    untouched++;
  }
}

console.log(JSON.stringify({ advanced, untouched, total: enrSnap.size }));
