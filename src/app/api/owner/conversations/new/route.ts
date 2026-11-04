/**
 * POST /api/owner/conversations/new
 *
 * Start a new conversation with a client (or arbitrary E.164 number).
 * If a conversation with that phone already exists, returns its ID
 * idempotently. Sends the first outbound message in one shot.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { isSmsConfigured, normalizePhone, sendSmsForTenant } from "@/lib/sms";
import type {
  ClientDoc,
  ConversationDoc,
  MessageDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    client_id: z.string().min(1).optional(),
    phone: z.string().optional(),
    body: z.string().trim().min(1).max(1500),
  })
  .strict()
  .refine((d) => d.client_id || d.phone, {
    message: "Provide client_id or phone.",
  });

const INBOX_ROLES = ["tenant_owner", "tenant_manager", "tenant_front_desk"] as const;

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!INBOX_ROLES.includes(ctx.user.role as (typeof INBOX_ROLES)[number])) {
    return NextResponse.json({ error: "Inbox is owner / manager / front-desk only." }, { status: 403 });
  }
  if (!isSmsConfigured()) {
    return NextResponse.json({ error: "SMS not configured." }, { status: 503 });
  }

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

  // Resolve recipient
  let phone: string | null = null;
  let clientId: string | null = parsed.data.client_id ?? null;
  if (parsed.data.client_id) {
    const cliSnap = await tenantCol(ctx.tenant.id, "clients").doc(parsed.data.client_id).get();
    if (!cliSnap.exists) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }
    const c = cliSnap.data() as ClientDoc;
    if (c.sms_consent === false) {
      return NextResponse.json(
        { error: "This client has opted out of SMS." },
        { status: 409 },
      );
    }
    phone = c.phone ? normalizePhone(c.phone) : null;
  } else if (parsed.data.phone) {
    phone = normalizePhone(parsed.data.phone);
  }
  if (!phone) {
    return NextResponse.json({ error: "Could not resolve a phone number." }, { status: 400 });
  }

  // Find or create conversation
  const convQuery = await tenantCol(ctx.tenant.id, "conversations")
    .where("client_phone", "==", phone)
    .limit(1)
    .get();

  let convRef: FirebaseFirestore.DocumentReference;
  if (!convQuery.empty) {
    convRef = convQuery.docs[0].ref;
    if (clientId === null) {
      clientId = (convQuery.docs[0].data() as ConversationDoc).client_id;
    }
  } else {
    convRef = tenantCol(ctx.tenant.id, "conversations").doc();
    const convDoc: Omit<ConversationDoc, "created_at" | "updated_at"> & {
      created_at: ReturnType<typeof now>;
      updated_at: ReturnType<typeof now>;
    } = {
      tenant_id: ctx.tenant.id,
      client_id: clientId,
      client_phone: phone,
      last_message_at: Timestamp.now(),
      last_message_preview: parsed.data.body.slice(0, 117),
      last_direction: "outbound",
      unread_count_for_owner: 0,
      archived_at: null,
      created_at: now(),
      updated_at: now(),
    };
    await convRef.create(convDoc);
  }

  // Send via Twilio
  const fromNumber = ctx.tenant.twilio_phone_number || process.env.TWILIO_FROM_NUMBER || "";
  if (!fromNumber) {
    return NextResponse.json(
      { error: "No outbound number. Configure Twilio in Settings." },
      { status: 503 },
    );
  }
  const result = await sendSmsForTenant(ctx.tenant, phone, parsed.data.body);
  if (!result.ok) {
    return NextResponse.json(
      { error: `Twilio send failed: ${"error" in result ? result.error : result.reason}` },
      { status: 502 },
    );
  }

  const preview =
    parsed.data.body.length > 120
      ? parsed.data.body.slice(0, 117) + "…"
      : parsed.data.body;

  // Update conversation + write message
  const msgRef = convRef.collection("messages").doc();
  const msgDoc: Omit<MessageDoc, "created_at"> & { created_at: ReturnType<typeof now> } = {
    tenant_id: ctx.tenant.id,
    conversation_id: convRef.id,
    client_id: clientId,
    direction: "outbound",
    body: parsed.data.body,
    from_number: fromNumber,
    to_number: phone,
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
    unread_count_for_owner: 0,
    updated_at: now(),
  });

  await writeAudit({
    action: "sms.outbound",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "conversation",
    targetId: convRef.id,
    after: { client_id: clientId, body_length: parsed.data.body.length, new_thread: true },
  });

  return NextResponse.json({ ok: true, conversation_id: convRef.id });
}
