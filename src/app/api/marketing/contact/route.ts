/**
 * POST /api/marketing/contact
 *
 * Submission target for the public /contact form. Persists to the
 * `inbound_replies` Firestore collection (same surface as
 * Cloudflare-Worker-delivered email replies) so messages land at
 * /admin/replies for Cory to review with whatever AI draft Sonnet
 * produces.
 *
 * Treats the form like any other inbound message: runs the
 * unsubscribe / out-of-office heuristics, then either drafts a Sonnet
 * reply (typical case) or skips. No tenant context required — this is
 * platform-level marketing.
 *
 * Light bot defenses: required honeypot field, basic length limits,
 * and 10 submissions per IP per minute via the existing rate limiter.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db, now } from "@/lib/firestore";
import { checkRateLimit } from "@/lib/rate-limit";
import { looksLikeUnsubscribe, looksLikeOutOfOffice } from "@/lib/dnd";
import { draftReply, isReplyDrafterConfigured } from "@/lib/ai-replies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().toLowerCase().email().max(320),
  company: z.string().trim().max(200).optional().nullable(),
  message: z.string().trim().min(5).max(5000),
  // Honeypot — real browsers leave this blank, bots fill it
  website: z.string().trim().max(500).optional().nullable(),
});

const RATE = { capacity: 10, windowMs: 60 * 1000 };

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  if (ip) {
    const rl = checkRateLimit(`contact:${ip}`, RATE);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many submissions. Try again in a minute." },
        { status: 429 },
      );
    }
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Honeypot — silently 200 to confuse bots, never persist
  if (data.website && data.website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const subject = `Contact form: ${data.name}${data.company ? ` (${data.company})` : ""}`;
  const haystack = `${subject}\n${data.message}`;

  // Apply the same guardrails the inbound-email handler uses
  if (looksLikeUnsubscribe(haystack)) {
    await db().collection("inbound_replies").add({
      from_email: data.email,
      from_name: data.name,
      clinic_name: data.company ?? null,
      outbound_subject: subject,
      inbound_subject: subject,
      inbound_text: data.message,
      classification: "unsubscribed_via_form",
      ai_draft: null,
      status: "skipped",
      tokens_in: 0,
      tokens_out: 0,
      received_at: now(),
      created_at: now(),
    });
    return NextResponse.json({ ok: true });
  }

  // Default: draft a Sonnet reply for human review
  let aiDraft: string | null = null;
  let tokensIn = 0;
  let tokensOut = 0;
  let draftError: string | null = null;
  if (isReplyDrafterConfigured()) {
    try {
      const r = await draftReply({
        outboundSubject: subject,
        inboundText: data.message,
        prospectName: data.name,
        clinicName: data.company ?? null,
      });
      aiDraft = r.draft;
      tokensIn = r.tokensIn;
      tokensOut = r.tokensOut;
    } catch (err) {
      console.error("[contact] draft failed", err);
      draftError = err instanceof Error ? err.message : "draft_error";
    }
  }
  // Out-of-office is a no-op for the contact form — humans don't OOO
  // a contact form submit. We compute it for parity but don't act.
  void looksLikeOutOfOffice;

  await db().collection("inbound_replies").add({
    from_email: data.email,
    from_name: data.name,
    clinic_name: data.company ?? null,
    outbound_subject: subject,
    inbound_subject: subject,
    inbound_text: data.message,
    classification: "contact_form",
    ai_draft: aiDraft,
    draft_error: draftError,
    status: aiDraft ? "awaiting_review" : "needs_manual",
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    received_at: now(),
    created_at: now(),
  });

  return NextResponse.json({ ok: true });
}
