/**
 * Claude Sonnet reply drafter.
 *
 * Given an inbound email (from a prospect replying to a nurture mail),
 * produces a concise, on-brand draft reply that Cory can approve, edit,
 * or discard from /admin/replies. Uses Claude Sonnet 4.6.
 *
 * The drafter is INTENTIONALLY conservative:
 *   - It never commits to specific dates / times / numbers.
 *   - It points the prospect at the booking modal for anything concrete.
 *   - It's first-person Cory and matches the tone of the nurture sequence.
 *   - Refuses to produce a reply for emails that look like out-of-office
 *     auto-replies or unsubscribe asks (those are handled before drafting).
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are drafting an email reply on behalf of Cory Salisbury, the founder and developer of Aesthera (a SaaS practice-management platform for med spas, aesthetic clinics, IV lounges, and wellness studios).

Cory's voice:
- First-person Cory. Warm, direct, no marketing fluff.
- Treats the reader like an adult who runs a real clinic.
- Short paragraphs. Concrete specifics over abstractions.
- Highlights direct dev access ("reply and you reach me directly").
- Acknowledges the prospect's situation before pitching.

Hard constraints:
- Never invent customer counts, specific feature dates, or compliance certifications we haven't yet earned.
- Never quote prices unless the prospect explicitly asked for pricing.
- For booking calls, point them at https://aesthera.io and the "Book a 15-min demo" button (we have a custom calendar there).
- For technical questions you can't answer with certainty, say so and offer a 15-min call.
- Sign off with "— Cory" only.
- Output plain text (no HTML, no markdown headings, no signature block beyond "— Cory").
- Keep the reply under 150 words unless the question genuinely needs more.
- Do NOT include subject line — just the body.

Context the user gives you:
- The original outbound email subject (so you know what they're replying to)
- The inbound reply text (what the prospect actually wrote)
- The prospect's name + clinic name if known

Your output: just the reply body, ready to send.`;

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (cached) return cached;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY not configured.");
  }
  cached = new Anthropic({ apiKey: key });
  return cached;
}

export function isReplyDrafterConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function draftReply(args: {
  outboundSubject: string | null;
  inboundText: string;
  prospectName: string | null;
  clinicName: string | null;
}): Promise<{ draft: string; tokensIn: number; tokensOut: number }> {
  const userPrompt = [
    args.outboundSubject
      ? `The prospect is replying to my email titled: "${args.outboundSubject}"`
      : "The prospect is replying to one of my Aesthera nurture emails.",
    args.prospectName ? `Prospect name: ${args.prospectName}` : null,
    args.clinicName ? `Clinic: ${args.clinicName}` : null,
    "",
    "Their reply (cleaned of quoted thread):",
    "---",
    args.inboundText.slice(0, 4000),
    "---",
    "",
    "Draft a reply on my behalf.",
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 700,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const draft = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return {
    draft,
    tokensIn: resp.usage.input_tokens,
    tokensOut: resp.usage.output_tokens,
  };
}
