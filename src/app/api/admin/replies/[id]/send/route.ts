/**
 * POST /api/admin/replies/[id]/send — approve + send an AI-drafted reply.
 *
 * Body: { body: string }  — the (possibly edited) reply text.
 * - Looks up the inbound_replies row by id
 * - Sends the reply via Resend, From=person1@example.com, To=fromEmail
 * - Marks the row status="sent" with sent_at + final_body
 * - Audit logs the send
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth-server";
import { EMAIL_FROM } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  body: z.string().trim().min(1).max(20_000),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const ref = db().collection("inbound_replies").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = snap.data() as Record<string, unknown>;
  if (r.status !== "awaiting_review" && r.status !== "needs_manual") {
    return NextResponse.json({ error: "Already processed" }, { status: 409 });
  }

  const fromEmail = String(r.from_email ?? "");
  const outboundSubject = String(r.outbound_subject ?? "(no subject)");
  const subject = outboundSubject.startsWith("Re:") ? outboundSubject : `Re: ${outboundSubject}`;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: "Resend not configured." }, { status: 503 });
  }

  // Convert plain text to safe HTML (paragraphs from blank lines)
  const html = parsed.data.body
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p>${p
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const sendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM.support,
      to: [fromEmail],
      reply_to: process.env.PLATFORM_DEMO_NOTIFY_EMAIL || "person1@example.com",
      subject,
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1b2636;line-height:1.6">${html}</div>`,
      text: parsed.data.body,
    }),
  });
  if (!sendRes.ok) {
    const errText = await sendRes.text().catch(() => "");
    return NextResponse.json({ error: `Send failed: ${sendRes.status} ${errText}` }, { status: 502 });
  }

  await ref.update({
    status: "sent",
    sent_at: now(),
    final_body: parsed.data.body,
    sent_by_uid: session.firebaseUid,
    sent_by_email: session.email,
  });
  await writeAudit({
    action: "lead.update",
    actorEmail: session.email,
    actorUserId: session.firebaseUid,
    targetType: "inbound_reply",
    targetId: id,
    after: { status: "sent", to: fromEmail, subject },
  });

  return NextResponse.json({ ok: true });
}
