/**
 * GET  /api/owner/conversations/[id]/messages — full thread
 * POST /api/owner/conversations/[id]/messages — send outbound SMS
 *
 * Outbound flow:
 *   1. Validate client opt-in (sms_consent !== false on the linked client).
 *   2. Send via Twilio from the tenant's twilio_phone_number (falls back
 *      to platform-wide TWILIO_FROM_NUMBER).
 *   3. Persist MessageDoc with the Twilio SID.
 *   4. Update conversation last_*.
 *   5. Audit.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now, toDate } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { isSmsConfigured, sendSmsForTenant } from "@/lib/sms";
import type {
  ClientDoc,
  ConversationDoc,
  MessageDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ body: z.string().trim().min(1).max(1500) }).strict();

export async function GET(
  _req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!["tenant_owner", "tenant_manager", "tenant_front_desk"].includes(ctx.user.role)) {
    return NextResponse.json({ error: "Inbox is owner / manager / front-desk only." }, { status: 403 });
  }
  const { id } = await rctx.params;

  const convRef = tenantCol(ctx.tenant.id, "conversations").doc(id);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const msgsSnap = await convRef
    .collection("messages")
    .orderBy("created_at", "asc")
    .limit(500)
    .get();
  const messages = msgsSnap.docs.map((d) => {
    const m = d.data() as MessageDoc;
    return {
      id: d.id,
      direction: m.direction,
      body: m.body,
      from_number: m.from_number,
      to_number: m.to_number,
      status: m.status,
      actor_email: m.actor_email,
      created_at: toDate(m.created_at),
    };
  });

  const conv = convSnap.data() as ConversationDoc;
  return NextResponse.json({
    ok: true,
    conversation: {
      id: convSnap.id,
      client_id: conv.client_id,
      client_phone: conv.client_phone,
      unread_count: conv.unread_count_for_owner,
      archived_at: toDate(conv.archived_at),
    },
    messages,
  });
}

export async function POST(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!["tenant_owner", "tenant_manager", "tenant_front_desk"].includes(ctx.user.role)) {
    return NextResponse.json({ error: "Inbox is owner / manager / front-desk only." }, { status: 403 });
  }
  if (!isSmsConfigured()) {
    return NextResponse.json({ error: "SMS not configured." }, { status: 503 });
  }
  const { id } = await rctx.params;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const convRef = tenantCol(ctx.tenant.id, "conversations").doc(id);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  const conv = convSnap.data() as ConversationDoc;

  // Verify opt-in if a client is linked
  if (conv.client_id) {
    const cliSnap = await tenantCol(ctx.tenant.id, "clients").doc(conv.client_id).get();
    if (cliSnap.exists) {
      const c = cliSnap.data() as ClientDoc;
      if (c.sms_consent === false) {
        return NextResponse.json(
          { error: "This client has opted out of SMS. Cannot send." },
          { status: 409 },
        );
      }
    }
  }

  const fromNumber = ctx.tenant.twilio_phone_number || process.env.TWILIO_FROM_NUMBER || "";
  if (!fromNumber) {
    return NextResponse.json(
      { error: "No outbound number configured. Set Twilio number in Settings." },
      { status: 503 },
    );
  }

  const result = await sendSmsForTenant(ctx.tenant, conv.client_phone, parsed.data.body);
  if (!result.ok) {
    return NextResponse.json(
      { error: `Twilio send failed: ${"error" in result ? result.error : result.reason}` },
      { status: 502 },
    );
  }

  // Persist outbound MessageDoc + update conversation
  const msgRef = convRef.collection("messages").doc();
  const preview =
    parsed.data.body.length > 120
      ? parsed.data.body.slice(0, 117) + "…"
      : parsed.data.body;

  const msgDoc: Omit<MessageDoc, "created_at"> & { created_at: ReturnType<typeof now> } = {
    tenant_id: ctx.tenant.id,
    conversation_id: id,
    client_id: conv.client_id,
    direction: "outbound",
    body: parsed.data.body,
    from_number: fromNumber,
    to_number: conv.client_phone,
    twilio_sid: result.sid,
    status: "sent",
    actor_user_id: ctx.user.firebaseUid,
    actor_email: ctx.user.email,
    is_keyword: false,
    created_at: now(),
  };
  await msgRef.create(msgDoc);
  await convRef.update({
    last_message_at: Timestamp.now(),
    last_message_preview: preview,
    last_direction: "outbound",
    // Sending a reply implicitly clears unread for the owner
    unread_count_for_owner: 0,
    updated_at: now(),
  });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;
  await writeAudit({
    action: "sms.outbound",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "conversation",
    targetId: id,
    after: { client_id: conv.client_id, body_length: parsed.data.body.length },
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true, sid: result.sid });
}
