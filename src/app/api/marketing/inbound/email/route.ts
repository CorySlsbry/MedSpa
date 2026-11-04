/**
 * POST /api/marketing/inbound/email — inbound reply parser.
 *
 * Wired to Cloudflare Email Routing via the `aesthera-inbound-email`
 * Worker (see `cloudflare/inbound-email-worker/` in this repo). The
 * Worker parses raw RFC822 from `person1@example.com` (and any other
 * routed addresses), POSTs the structured payload here, AND forwards a
 * copy to your personal Gmail.
 *
 * Resend Inbound is NOT used. Resend's API confirms aesthera.io has
 * `receiving: disabled` — Cloudflare owns MX. The Worker pattern keeps
 * Cloudflare for forwarding while still triggering this handler
 * programmatically.
 *
 * Three cases the handler runs through:
 *   1. UNSUBSCRIBE-shaped → flag DND + cancel queued scheduled_emails.
 *   2. OUT-OF-OFFICE → log + skip, no Sonnet call.
 *   3. Anything else → Sonnet drafts a reply, row goes into
 *      `inbound_replies` with status="awaiting_review" for review at
 *      /admin/replies.
 *
 * Auth: `INBOUND_EMAIL_SECRET` env var (mounted from Secret Manager).
 * The Worker passes it as `?key=...`. Required in production —
 * unauthenticated POSTs return 401, AND the route logs a loud warning
 * if the env var itself is missing server-side so a misconfigured
 * deploy doesn't silently let everyone in.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { flagContactDnd, looksLikeUnsubscribe, looksLikeOutOfOffice } from "@/lib/dnd";
import { draftReply, isReplyDrafterConfigured } from "@/lib/ai-replies";
import type { ContactDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resend inbound webhook payload (subset we care about). Field names
// follow Resend's inbound spec. If you wire a different inbound service,
// adapt the shape here.
const InboundSchema = z.object({
  // The address that received the message (e.g. person1@example.com)
  to: z.union([z.string(), z.array(z.string())]).optional(),
  // The sender — extract email from "Name <addr>" if present
  from: z.string().trim().min(3).max(500),
  subject: z.string().trim().max(500).default(""),
  // Plain-text body if present, otherwise we'll fall back to text-extracted
  // version of HTML (best-effort)
  text: z.string().max(50_000).optional(),
  html: z.string().max(200_000).optional(),
  // Outbound message-id this is a reply to (Resend sets this when it can
  // correlate to a previously-sent message). Used to look up the original
  // outbound subject for the AI drafter context.
  in_reply_to: z.string().trim().max(500).optional().nullable(),
  // The original outbound subject if the inbound parser is nice enough
  // to include it. Otherwise we strip "Re:" from the inbound subject.
  references: z.string().trim().max(500).optional().nullable(),
});

function extractEmail(fromHeader: string): string | null {
  const m = fromHeader.match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  if (fromHeader.includes("@")) return fromHeader.trim().toLowerCase();
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop the quoted thread tail so the AI doesn't draft replies to its own prior emails. */
function stripQuotedThread(text: string): string {
  // Common patterns: "On Mon, ... wrote:" or "> " prefix lines
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/i.test(line)) break;
    if (/^-{3,}\s*Original Message\s*-{3,}/i.test(line)) break;
    if (/^From:.*\bAesthera\b/i.test(line)) break;
    out.push(line);
  }
  return out
    .filter((l) => !/^>/.test(l))
    .join("\n")
    .trim();
}

function maybeStripRePrefix(s: string): string {
  return s.replace(/^(?:re:|fwd?:|aw:)\s+/i, "").trim();
}

export async function POST(req: Request) {
  // Required shared-secret check. The Cloudflare Email Worker passes
  // ?key=<INBOUND_EMAIL_SECRET> on every request. Anything else is
  // either a probe or a misconfigured caller — drop with 401.
  const expected = process.env.INBOUND_EMAIL_SECRET;
  if (!expected) {
    // Log loud + reject. A missing secret means the env var didn't
    // mount on Cloud Run; better to fail closed than silently allow.
    console.error(
      "[inbound-email] INBOUND_EMAIL_SECRET env var missing — failing closed",
    );
    return NextResponse.json(
      { error: "Inbound email handler is not configured." },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const supplied = url.searchParams.get("key");
  if (supplied !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = InboundSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid inbound payload." }, { status: 400 });
  }
  const data = parsed.data;
  const fromEmail = extractEmail(data.from);
  if (!fromEmail) {
    return NextResponse.json({ ok: true, ignored: "no_from_email" });
  }

  const text = (data.text || (data.html ? stripHtml(data.html) : "")).trim();
  const cleaned = stripQuotedThread(text).slice(0, 12_000);
  const subject = data.subject;
  const haystack = `${subject}\n${cleaned}`;

  // Look up the contact (may not exist; that's OK)
  const contactRef = db().collection("contacts").doc(fromEmail);
  const contactSnap = await contactRef.get();
  const contact = contactSnap.exists ? (contactSnap.data() as ContactDoc) : null;

  // 1. UNSUBSCRIBE-shaped → DND
  if (looksLikeUnsubscribe(haystack)) {
    const dnd = await flagContactDnd(fromEmail, "unsubscribed", subject.slice(0, 200));
    await writeAudit({
      action: "admin.user_suspend",
      actorEmail: fromEmail,
      targetType: "contact.unsubscribed",
      targetId: fromEmail,
      after: { source: "inbound_email", subject, scheduled_cancelled: dnd.cancelledScheduled },
    });
    return NextResponse.json({ ok: true, action: "unsubscribed", scheduled_cancelled: dnd.cancelledScheduled });
  }

  // 2. OUT-OF-OFFICE → log + skip
  if (looksLikeOutOfOffice({ subject, body: cleaned })) {
    await db().collection("inbound_replies").add({
      from_email: fromEmail,
      from_name: contact?.full_name ?? null,
      clinic_name: contact?.company_name ?? null,
      outbound_subject: maybeStripRePrefix(subject),
      inbound_subject: subject,
      inbound_text: cleaned.slice(0, 8000),
      classification: "out_of_office",
      ai_draft: null,
      status: "skipped",
      tokens_in: 0,
      tokens_out: 0,
      received_at: now(),
      created_at: now(),
    });
    return NextResponse.json({ ok: true, action: "out_of_office_skipped" });
  }

  // 3. Real reply → draft via Sonnet, queue for approval
  let aiDraft: string | null = null;
  let tokensIn = 0;
  let tokensOut = 0;
  let draftError: string | null = null;
  if (isReplyDrafterConfigured() && cleaned.length > 0) {
    try {
      const r = await draftReply({
        outboundSubject: maybeStripRePrefix(subject),
        inboundText: cleaned,
        prospectName: contact?.full_name ?? null,
        clinicName: contact?.company_name ?? null,
      });
      aiDraft = r.draft;
      tokensIn = r.tokensIn;
      tokensOut = r.tokensOut;
    } catch (err) {
      console.error("[inbound-email] draft failed", err);
      draftError = (err as { message?: string }).message ?? "draft_error";
    }
  }

  await db().collection("inbound_replies").add({
    from_email: fromEmail,
    from_name: contact?.full_name ?? null,
    clinic_name: contact?.company_name ?? null,
    outbound_subject: maybeStripRePrefix(subject),
    inbound_subject: subject,
    inbound_text: cleaned.slice(0, 8000),
    classification: "needs_reply",
    ai_draft: aiDraft,
    draft_error: draftError,
    status: aiDraft ? "awaiting_review" : "needs_manual",
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    received_at: now(),
    created_at: now(),
  });

  return NextResponse.json({
    ok: true,
    action: aiDraft ? "drafted" : "queued_no_draft",
  });
}
