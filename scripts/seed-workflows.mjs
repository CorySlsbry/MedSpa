/**
 * Seed (or re-seed) the two Aesthera nurture workflows with the full
 * cold-outreach email sequences inline. Idempotent: looks up by name and
 * UPDATES if found, creates if not. Run after each content change.
 *
 * Usage: node scripts/seed-workflows.mjs
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault(), projectId: "medspa-494718" });
const db = getFirestore();

// ── Email content ───────────────────────────────────────────────────────────
//
// Cold-outreach best practices:
//   - 60-100 word body, 3-4 sentences
//   - Subject under 60 chars, lowercase or sentence case (looks human)
//   - One specific CTA per email
//   - Every email references the clinic by name
//   - First-name personalization in opener
//   - Break-up email at the end of every sequence
//
// Variables: {{first_name}}, {{company_name}}, {{city}}, {{sender_name}},
// {{sender_email}}, {{full_name}}, {{state}}, {{website}}.

function id(s) {
  return `step_${s}`;
}

function emailStep(stepId, opts) {
  return {
    id: id(stepId),
    action: "send_email",
    config: {
      subject: opts.subject,
      body_html: opts.html,
      body_text: opts.text,
      from_name: opts.from_name ?? "Cory Salisbury",
    },
  };
}

function waitStep(stepId, days) {
  return { id: id(stepId), action: "wait", config: { days } };
}

function tagStep(stepId, tag) {
  return { id: id(stepId), action: "apply_tag", config: { tag } };
}

function statusStep(stepId, status) {
  return { id: id(stepId), action: "set_lead_status", config: { status } };
}

// ── Short sequence: 5 touches over ~14 days ─────────────────────────────────

const SHORT_STEPS = [
  emailStep("short_1_intro", {
    subject: "question about {{company_name}}",
    text: `{{first_name}},

Saw {{company_name}} online — looks like you're doing real work over there. I'm building software for med spas (one platform instead of seven — booking, charts, photos, marketing, payments) and I'd love your eyes on it for 15 min.

No pitch, just a walkthrough. If it's useful, great. If not, no harm.

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>Saw {{company_name}} online — looks like you're doing real work over there. I'm building software for med spas (one platform instead of seven — booking, charts, photos, marketing, payments) and I'd love your eyes on it for 15 min.</p><p>No pitch, just a walkthrough. If it's useful, great. If not, no harm.</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("short_w1", 3),
  emailStep("short_2_pain", {
    subject: "a quieter front desk",
    text: `Hey {{first_name}} —

Most med spa front desks lose 90 minutes a day re-typing client info into 4 different tools. Aesthera makes that one form. One client record. One bill.

14-day free trial, no credit card. If you go paid and it isn't earning its keep in 30 days, full refund. Genuinely low-risk peek.

Want me to walk you through it for 15?

— {{sender_name}}
aesthera.io`,
    html: `<p>Hey {{first_name}} —</p><p>Most med spa front desks lose 90 minutes a day re-typing client info into 4 different tools. Aesthera makes that one form. One client record. One bill.</p><p>14-day free trial, no credit card. If you go paid and it isn't earning its keep in 30 days, full refund. Genuinely low-risk peek.</p><p>Want me to walk you through it for 15?</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("short_w2", 4),
  emailStep("short_3_proof", {
    subject: "thought of {{company_name}}",
    text: `{{first_name}},

A founding clinic told me they were running their books on a spreadsheet, charts on paper, and marketing on whatever Mailchimp template was open at midnight. Six weeks on Aesthera and their no-shows dropped 40%, front desk got 9 hrs/week back.

14 free days to try, no card. 30-day money-back if you go paid and it flops. Downside is basically zero.

Worth a peek for {{company_name}}?

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>A founding clinic told me they were running their books on a spreadsheet, charts on paper, and marketing on whatever Mailchimp template was open at midnight. Six weeks on Aesthera and their no-shows dropped 40%, front desk got 9 hrs/week back.</p><p>14 free days to try, no card. 30-day money-back if you go paid and it flops. Downside is basically zero.</p><p>Worth a peek for {{company_name}}?</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("short_w3", 4),
  emailStep("short_4_ask", {
    subject: "15 min next week, {{first_name}}?",
    text: `{{first_name}},

Direct ask — 15 min on Zoom, Aesthera pre-loaded for {{company_name}}. You'll see exactly what your front desk would touch each day.

If it's not a fit, you tell me. No follow-up, no sequence, gone.

Reply with a day that works?

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>Direct ask — 15 min on Zoom, Aesthera pre-loaded for {{company_name}}. You'll see exactly what your front desk would touch each day.</p><p>If it's not a fit, you tell me. No follow-up, no sequence, gone.</p><p>Reply with a day that works?</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("short_w4", 3),
  emailStep("short_5_breakup", {
    subject: "should I close this out, {{first_name}}?",
    text: `{{first_name}},

I've sent a few notes — totally fine if it's not your moment, you're busy.

If now's not the right time, hit reply with "not now" and I'll archive {{company_name}} clean.

If you ever want to actually look — the door's open. 14-day free trial, no credit card needed.

— {{sender_name}}
{{sender_email}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>I've sent a few notes — totally fine if it's not your moment, you're busy.</p><p>If now's not the right time, hit reply with "not now" and I'll archive {{company_name}} clean.</p><p>If you ever want to actually look — the door's open. 14-day free trial, no credit card needed.</p><p>— {{sender_name}}<br>{{sender_email}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  statusStep("short_status_no_response", "no_response"),
];

// ── Long sequence: 12 touches over ~90 days ────────────────────────────────

const LONG_STEPS = [
  emailStep("long_1_intro", {
    subject: "thought of {{company_name}}",
    text: `{{first_name}},

This might or might not be useful — but I built a platform for med spas (one app for booking, charts, photos, marketing, payments) and {{company_name}} is exactly the kind of clinic I had in mind.

15 min next week? I'll show you what it looks like and you can tell me if it's silly.

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>This might or might not be useful — but I built a platform for med spas (one app for booking, charts, photos, marketing, payments) and {{company_name}} is exactly the kind of clinic I had in mind.</p><p>15 min next week? I'll show you what it looks like and you can tell me if it's silly.</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("long_w1", 3),
  emailStep("long_2_pain", {
    subject: "a quieter front desk",
    text: `Hey {{first_name}} —

Most med spa front desks lose 90 minutes a day re-typing client info into 4 different tools. Aesthera makes that one form. One client record. One bill.

14-day free trial, no credit card. If you go paid and it isn't earning its keep in 30 days, full refund. Genuinely low-risk.

Worth a peek for {{company_name}}?

— {{sender_name}}
aesthera.io`,
    html: `<p>Hey {{first_name}} —</p><p>Most med spa front desks lose 90 minutes a day re-typing client info into 4 different tools. Aesthera makes that one form. One client record. One bill.</p><p>14-day free trial, no credit card. If you go paid and it isn't earning its keep in 30 days, full refund. Genuinely low-risk.</p><p>Worth a peek for {{company_name}}?</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("long_w2", 4),
  emailStep("long_3_proof", {
    subject: "question about {{company_name}}",
    text: `{{first_name}},

Saw {{company_name}} — looks like you're running things right. A clinic similar to yours flipped to Aesthera in March. After 6 weeks: no-shows down 39%, front desk got 9 hrs back a week.

14-day free trial, no card. 30-day money-back if you go paid and it doesn't pull its weight. Downside is basically zero.

Want me to walk you through it for 15?

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>Saw {{company_name}} — looks like you're running things right. A clinic similar to yours flipped to Aesthera in March. After 6 weeks: no-shows down 39%, front desk got 9 hrs back a week.</p><p>14-day free trial, no card. 30-day money-back if you go paid and it doesn't pull its weight. Downside is basically zero.</p><p>Want me to walk you through it for 15?</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("long_w3", 4),
  emailStep("long_4_ask", {
    subject: "15 min, {{company_name}}?",
    text: `{{first_name}},

Direct ask — 15 min on Zoom, Aesthera pre-loaded for {{company_name}}. You'll see what your front desk would touch each day, what the embed widget feels like on a client's phone, what the marketing engine would do for you.

Worst case, 15 min spent confirming you've got the right stack. Reply with a day?

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>Direct ask — 15 min on Zoom, Aesthera pre-loaded for {{company_name}}. You'll see what your front desk would touch each day, what the embed widget feels like on a client's phone, what the marketing engine would do for you.</p><p>Worst case, 15 min spent confirming you've got the right stack. Reply with a day?</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("long_w4", 3),
  emailStep("long_5_softclose", {
    subject: "should I close this out, {{first_name}}?",
    text: `{{first_name}},

Haven't heard back — no worries, busy season for everyone.

Two paths: "not now" and I close the file, or "send me the demo" and I send a 15-min walkthrough you watch on your schedule.

Either is fine. Just didn't want to fade out without a clean answer.

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>Haven't heard back — no worries, busy season for everyone.</p><p>Two paths: "not now" and I close the file, or "send me the demo" and I send a 15-min walkthrough you watch on your schedule.</p><p>Either is fine. Just didn't want to fade out without a clean answer.</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  // ── Slow burn re-engagement ──
  waitStep("long_w5", 16),
  emailStep("long_6_new_angle", {
    subject: "thought you'd like this one",
    text: `{{first_name}},

New thing inside Aesthera I want you to see — an AI booking concierge that lives in your embed widget.

Someone lands on {{company_name}}'s site, says "I want to look more rested, what should I get?" and the AI walks them to the right service, books them in, routes the file to the right provider.

Cuts the consult-call workload to almost nothing. Want a peek?

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>New thing inside Aesthera I want you to see — an AI booking concierge that lives in your embed widget.</p><p>Someone lands on {{company_name}}'s site, says "I want to look more rested, what should I get?" and the AI walks them to the right service, books them in, routes the file to the right provider.</p><p>Cuts the consult-call workload to almost nothing. Want a peek?</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("long_w6", 7),
  emailStep("long_7_compliance", {
    subject: "a thought on injectable charting",
    text: `{{first_name}},

If {{company_name}} is charting injectables, the HIPAA exposure is real. Most med spa software either ignores it or makes you bolt on a $200/mo EMR.

Aesthera's charting is HIPAA-ready out of the box. SOAP next to the schedule. Locked + immutable per HIPAA. Photos to encrypted storage. BAA signed at signup.

If getting charting in order is on your list this year — this is the cleanest path. Want a tour?

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>If {{company_name}} is charting injectables, the HIPAA exposure is real. Most med spa software either ignores it or makes you bolt on a $200/mo EMR.</p><p>Aesthera's charting is HIPAA-ready out of the box. SOAP next to the schedule. Locked + immutable per HIPAA. Photos to encrypted storage. BAA signed at signup.</p><p>If getting charting in order is on your list this year — this is the cleanest path. Want a tour?</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("long_w7", 8),
  emailStep("long_8_case_study", {
    subject: "$14K from one trigger",
    text: `{{first_name}},

A med spa on Aesthera ran one campaign last quarter — a 21-day post-treatment check-in for Botox clients. AI pulled the list, generated a personal email per client, sent the soft "how are you feeling, want to rebook?" hit.

$14,200 in rebooked revenue, six weeks. From one trigger.

That's the kind of thing the marketing engine just does for you in the background. Worth seeing?

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>A med spa on Aesthera ran one campaign last quarter — a 21-day post-treatment check-in for Botox clients. AI pulled the list, generated a personal email per client, sent the soft "how are you feeling, want to rebook?" hit.</p><p>$14,200 in rebooked revenue, six weeks. From one trigger.</p><p>That's the kind of thing the marketing engine just does for you in the background. Worth seeing?</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("long_w8", 15),
  emailStep("long_9_founding", {
    subject: "founding-25 closing soon, {{company_name}}",
    text: `{{first_name}},

Quick update — a few founding seats left at $99/mo locked for life. After they go, the price is $399/mo and the founding-cohort perks (priority support, monthly office hours with me) close.

If the idea of one platform for booking, charts, marketing, and payments sounds useful — this is the cleanest moment to grab it.

Reply "save me a spot" and I'll send the next step.

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>Quick update — a few founding seats left at $99/mo locked for life. After they go, the price is $399/mo and the founding-cohort perks (priority support, monthly office hours with me) close.</p><p>If the idea of one platform for booking, charts, marketing, and payments sounds useful — this is the cleanest moment to grab it.</p><p>Reply "save me a spot" and I'll send the next step.</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("long_w9", 15),
  emailStep("long_10_question", {
    subject: "one question, {{first_name}}",
    text: `{{first_name}},

Genuine question — what's the biggest hour-eater in {{company_name}}'s week right now?

Scheduling chaos, no-shows, missed rebooks, marketing, charting — Aesthera covers it. Hiring, payroll, insurance — we don't (yet).

Trying to figure out if I'm actually useful to you. Two-line reply works.

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>Genuine question — what's the biggest hour-eater in {{company_name}}'s week right now?</p><p>Scheduling chaos, no-shows, missed rebooks, marketing, charting — Aesthera covers it. Hiring, payroll, insurance — we don't (yet).</p><p>Trying to figure out if I'm actually useful to you. Two-line reply works.</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("long_w10", 10),
  emailStep("long_11_value_drop", {
    subject: "free, no catch",
    text: `{{first_name}},

Sharing this with you whether you ever look at Aesthera or not — because it works.

The playbook I use to build the AI marketing engine has 5 trigger-based campaigns that move the needle most for med spas: birthday week, 21-day post-treatment, 90-day reactivation, new-client welcome, service upsell.

Reply "send the playbook" and I'll forward it. No strings.

— {{sender_name}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>Sharing this with you whether you ever look at Aesthera or not — because it works.</p><p>The playbook I use to build the AI marketing engine has 5 trigger-based campaigns that move the needle most for med spas: birthday week, 21-day post-treatment, 90-day reactivation, new-client welcome, service upsell.</p><p>Reply "send the playbook" and I'll forward it. No strings.</p><p>— {{sender_name}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  waitStep("long_w11", 5),
  emailStep("long_12_final_breakup", {
    subject: "closing your file, {{first_name}}",
    text: `{{first_name}},

Last note from me — going to close out {{company_name}} from my outreach today. Sent enough.

If Aesthera ever makes sense down the road, just reply and I'll re-open. The Founding-25 price won't be available then, but the platform only gets better.

Wishing {{company_name}} a strong year.

— {{sender_name}}
{{sender_email}}
aesthera.io`,
    html: `<p>{{first_name}},</p><p>Last note from me — going to close out {{company_name}} from my outreach today. Sent enough.</p><p>If Aesthera ever makes sense down the road, just reply and I'll re-open. The Founding-25 price won't be available then, but the platform only gets better.</p><p>Wishing {{company_name}} a strong year.</p><p>— {{sender_name}}<br>{{sender_email}}<br><a href="https://aesthera.io">aesthera.io</a></p>`,
  }),
  statusStep("long_status_no_response", "no_response"),
];

// ── Workflow definitions ───────────────────────────────────────────────────

const WORKFLOWS = [
  {
    name: "Aesthera Cold Outreach — Short",
    description: "5-touch short nurture for cold prospects, ~14 days. Trigger tag drives the external email runner.",
    trigger_type: "manual",
    trigger_config: { tag: "aesthera-cold-outreach-short" },
    status: "active",
    cooldown_days: 30,
    steps: SHORT_STEPS,
  },
  {
    name: "Aesthera Cold Outreach — Long",
    description: "12-touch long nurture for cold prospects + slow-burn re-engagement, ~90 days.",
    trigger_type: "manual",
    trigger_config: { tag: "aesthera-cold-outreach-long" },
    status: "active",
    cooldown_days: 60,
    steps: LONG_STEPS,
  },
];

for (const w of WORKFLOWS) {
  const existing = await db
    .collection("workflows")
    .where("name", "==", w.name)
    .limit(1)
    .get();
  if (!existing.empty) {
    const ref = existing.docs[0].ref;
    await ref.update({
      description: w.description,
      trigger_type: w.trigger_type,
      trigger_config: w.trigger_config,
      status: w.status,
      cooldown_days: w.cooldown_days,
      steps: w.steps,
      updated_at: FieldValue.serverTimestamp(),
    });
    console.log(`[updated] ${w.name} (${ref.id}) — ${w.steps.length} steps`);
  } else {
    const ref = db.collection("workflows").doc();
    await ref.set({
      name: w.name,
      description: w.description,
      trigger_type: w.trigger_type,
      trigger_config: w.trigger_config,
      steps: w.steps,
      status: w.status,
      cooldown_days: w.cooldown_days,
      active_enrollments: 0,
      total_enrollments: 0,
      created_by_user_id: null,
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    });
    console.log(`[created] ${w.name} → ${ref.id} (${w.steps.length} steps)`);
  }
}
console.log("Done.");
