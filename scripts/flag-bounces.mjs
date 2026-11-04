/**
 * One-off: flag known bounces as DND.
 *
 * Use when bounces show up in the forwarded mailbox but didn't come
 * through the Resend webhook (e.g. recipient bounced after the
 * webhook event window, or the message was sent by a path that
 * doesn't fire the webhook). Uses the same helper the webhook calls,
 * so the result is identical: contact.do_not_contact=true, dnd tags
 * applied, queued scheduled_emails for that recipient marked skipped.
 *
 * Run:
 *   node scripts/flag-bounces.mjs
 *
 * Idempotent — re-running on a contact that's already DND just
 * refreshes last_dnd_at + last_dnd_reason.
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault(), projectId: "medspa-494718" });
const db = getFirestore();

// Stay in lockstep with src/lib/dnd.ts. Imported via Node here would
// pull in the whole TS app — easier to inline this small surface.
async function flagContactDnd(email, reason, detail) {
  const lc = email.toLowerCase().trim();
  const ref = db.collection("contacts").doc(lc);
  const snap = await ref.get();
  let flagged = false;
  let createdStub = false;

  if (snap.exists) {
    const cur = snap.data();
    const existingTags = Array.isArray(cur.tags) ? cur.tags : [];
    const dndTag = `dnd:${reason}`;
    const tags = existingTags.includes("dnd") ? existingTags : [...existingTags, "dnd"];
    const tagsWithReason = tags.includes(dndTag) ? tags : [...tags, dndTag];

    const update = {
      do_not_contact: true,
      tags: tagsWithReason,
      updated_at: FieldValue.serverTimestamp(),
      last_dnd_at: FieldValue.serverTimestamp(),
      last_dnd_reason: reason,
    };
    if (reason === "unsubscribed" || reason === "complained") {
      update.email_unsubscribed = true;
    }
    if (detail) update.last_dnd_detail = detail;
    await ref.update(update);
    flagged = true;
  } else {
    // Create a DND stub so any future Jarvis ingest / demo seed / manual
    // import that targets this email lands on an already-DND'd doc and
    // never enters the send pipeline. Doc ID = lowercased email, which
    // matches every contact-creation path in the codebase.
    const stub = {
      email: lc,
      full_name: null,
      phone: null,
      role: null,
      company_id: null,
      company_name: null,
      do_not_contact: true,
      email_unsubscribed: reason === "unsubscribed" || reason === "complained",
      sms_unsubscribed: false,
      source: "bounce_suppression",
      tags: ["dnd", `dnd:${reason}`, "stub"],
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      last_dnd_at: FieldValue.serverTimestamp(),
      last_dnd_reason: reason,
      last_dnd_detail: detail ?? null,
    };
    await ref.set(stub);
    flagged = true;
    createdStub = true;
  }

  const queuedSnap = await db
    .collection("scheduled_emails")
    .where("recipient_email", "==", lc)
    .where("status", "==", "queued")
    .get();
  let cancelled = 0;
  if (!queuedSnap.empty) {
    const batch = db.batch();
    for (const d of queuedSnap.docs) {
      batch.update(d.ref, { status: "skipped", error: `cancelled_dnd:${reason}` });
    }
    await batch.commit();
    cancelled = queuedSnap.size;
  }

  return { flagged, cancelled, contactExisted: snap.exists, createdStub };
}

const targets = [
  {
    email: "person1@example.com",
    reason: "bounce_hard",
    detail: "550 5.2.1 The email account that you tried to reach is inactive.",
  },
  {
    email: "person2@example.com",
    reason: "bounce_soft",
    detail: "554 5.2.122 The recipient has exceeded their limit for the number of messages they can receive per hour.",
  },
];

for (const t of targets) {
  // Show the doc state BEFORE we touch it so we know what changed.
  const before = await db.collection("contacts").doc(t.email).get();
  const beforeState = before.exists
    ? {
        do_not_contact: before.data().do_not_contact ?? false,
        tags: before.data().tags ?? [],
        last_dnd_reason: before.data().last_dnd_reason ?? null,
      }
    : null;

  const result = await flagContactDnd(t.email, t.reason, t.detail);
  console.log(JSON.stringify({ email: t.email, before: beforeState, result }, null, 2));
}
