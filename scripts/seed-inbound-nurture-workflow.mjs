/**
 * Create / update the "Aesthera Inbound Nurture" workflow doc so it
 * shows up in /admin/workflows. The actual sending mechanism lives in
 * src/lib/nurture.ts + the scheduled_emails cron — this doc is the
 * source of truth for what the funnel LOOKS like to the operator.
 *
 * Idempotent: re-running updates the existing doc.
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault(), projectId: "medspa-494718" });
const db = getFirestore();

const WORKFLOW_ID = "aesthera-inbound-nurture";
const NURTURE_TAG = "aesthera-inbound-nurture";

const STEPS = [
  {
    id: "step_day_0",
    action: "send_email",
    config: {
      subject: "How seven tools become one",
      from_name: "Cory at Aesthera",
      summary:
        "Day 0 · Friendly first reach-out. Lead with empathy and the seven-to-one thesis. Highlight direct dev access. Soft CTA to book.",
    },
  },
  { id: "step_wait_2", action: "wait", config: { days: 2 } },
  {
    id: "step_day_2",
    action: "send_email",
    config: {
      subject: "Where did you put the photo?",
      from_name: "Cory at Aesthera",
      summary:
        "Day 2 · Clinical specifics. Open with the Tuesday-at-11 patient scenario. Walk through chart + photos + consents + AI SOAP draft.",
    },
  },
  { id: "step_wait_2b", action: "wait", config: { days: 2 } },
  {
    id: "step_day_4",
    action: "send_email",
    config: {
      subject: "AI that runs while your team sleeps",
      from_name: "Cory at Aesthera",
      summary:
        "Day 4 · Growth side. Five behavioral triggers + Stripe Connect. Founding-25 nudge.",
    },
  },
  { id: "step_wait_10", action: "wait", config: { days: 10 } },
  {
    id: "step_day_14",
    action: "send_email",
    config: {
      subject: "Quick check-in — founding-25 spots are filling",
      from_name: "Cory at Aesthera",
      summary:
        "Day 14 · Soft check-in. Surface white-glove option + remind about founding-25. Friendly, not pushy.",
    },
  },
  { id: "step_wait_16", action: "wait", config: { days: 16 } },
  {
    id: "step_day_30",
    action: "send_email",
    config: {
      subject: "What we shipped this month for clinics like yours",
      from_name: "Cory at Aesthera",
      summary:
        "Day 30 · Concrete shipped-features update. Stripe Connect, two-way SMS, photos, AI SOAP — all live.",
    },
  },
  { id: "step_wait_30", action: "wait", config: { days: 30 } },
  {
    id: "step_day_60",
    action: "send_email",
    config: {
      subject: "How one Utah clinic cut their admin hours in half",
      from_name: "Cory at Aesthera",
      summary:
        "Day 60 · Pattern observation: 40-60% admin hours drop in month one. Owner-time-back framing.",
    },
  },
  { id: "step_wait_30b", action: "wait", config: { days: 30 } },
  {
    id: "step_day_90",
    action: "send_email",
    config: {
      subject: "Three things changing in med-spa software this quarter",
      from_name: "Cory at Aesthera",
      summary:
        "Day 90 · Industry trend / value piece. HIPAA enforcement up, AI charting standard, Stripe Connect default.",
    },
  },
  { id: "step_wait_90", action: "wait", config: { days: 90 } },
  {
    id: "step_day_180",
    action: "send_email",
    config: {
      subject: "Six months later — want a fresh look at Aesthera?",
      from_name: "Cory at Aesthera",
      summary:
        "Day 180 · Re-engagement. Acknowledge time has passed, offer a fresh walkthrough.",
    },
  },
  { id: "step_wait_180", action: "wait", config: { days: 180 } },
  {
    id: "step_day_365",
    action: "send_email",
    config: {
      subject: "One year. New tools. Still building for clinics like yours.",
      from_name: "Cory at Aesthera",
      summary:
        "Day 365 · Final touch. Close the loop with grace. This is the last note unless they reach back.",
    },
  },
];

const ref = db.collection("workflows").doc(WORKFLOW_ID);
const existing = await ref.get();
const data = {
  name: "Aesthera Inbound Nurture",
  description:
    "Evergreen 9-touch nurture for inbound info-form leads. Day 0/2/4 concentrated drip, then long-tail check-ins at Day 14, 30, 60, 90, 180, 365 so we never lose a lead. Friendly, value-led, dev-direct copy. Copy and send mechanism live in src/lib/nurture.ts; this workflow doc is the source of truth for what the funnel looks like in /admin/workflows.",
  status: "active",
  trigger_type: "tag",
  trigger_config: { tag: NURTURE_TAG },
  cooldown_days: 365,
  steps: STEPS,
  active_enrollments: existing.exists ? existing.data().active_enrollments ?? 0 : 0,
  total_enrollments: existing.exists ? existing.data().total_enrollments ?? 0 : 0,
  created_at: existing.exists
    ? existing.data().created_at
    : Timestamp.now(),
  updated_at: Timestamp.now(),
};

await ref.set(data, { merge: false });
console.log(
  `${existing.exists ? "Updated" : "Created"} workflow: ${WORKFLOW_ID} · ${STEPS.length} steps · trigger tag: ${NURTURE_TAG}`,
);
process.exit(0);
