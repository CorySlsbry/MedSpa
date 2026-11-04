/**
 * POST /api/sms/inbound
 *
 * Twilio webhook for inbound messages. Validates the Twilio signature,
 * resolves the tenant by destination number, finds-or-creates the
 * conversation by client phone number, appends the inbound MessageDoc,
 * and increments unread_count_for_owner.
 *
 * Handles STOP/START keywords by toggling ClientDoc.sms_consent.
 *
 * Twilio expects an empty 200 response (or TwiML XML for an auto-reply).
 * We return empty 200; the inbox UI is the response.
 */

import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db, now } from "@/lib/firestore";
import { tenantCol } from "@/lib/tenant";
import { writeAudit } from "@/lib/audit";
import { decryptToken } from "@/lib/oauth";
import {
  isOptInKeyword,
  isOptOutKeyword,
  normalizePhone,
  validateTwilioSignature,
} from "@/lib/sms";
import type {
  ClientDoc,
  ConversationDoc,
  MessageDoc,
  TenantDoc,
} from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const fromRaw = params.get("From");
  const toRaw = params.get("To");
  const body = (params.get("Body") ?? "").trim();
  const sid = params.get("MessageSid");
  if (!fromRaw || !toRaw || !body) {
    return new NextResponse("missing fields", { status: 400 });
  }
  const fromE164 = normalizePhone(fromRaw);
  const toE164 = normalizePhone(toRaw);
  if (!fromE164 || !toE164) {
    return new NextResponse("invalid numbers", { status: 400 });
  }

  // Resolve tenant by destination Twilio number FIRST so we know which
  // auth token Twilio used to sign this request. Subaccount-owned
  // numbers are signed with the subaccount's token, not master's.
  const tenantSnap = await db()
    .collection("tenants")
    .where("twilio_phone_number", "==", toE164)
    .limit(1)
    .get();
  if (tenantSnap.empty) {
    console.warn("[sms-inbound] no tenant for number", toE164);
    return new NextResponse(twiML(""), { status: 200, headers: twiHeaders() });
  }
  const tenant = tenantSnap.docs[0].data() as TenantDoc;
  const tenantId = tenantSnap.docs[0].id;

  // Validate with subaccount auth token if provisioned, else master.
  let validateToken: string | undefined;
  if (tenant.twilio_subaccount_auth_token_enc) {
    try {
      validateToken = decryptToken(tenant.twilio_subaccount_auth_token_enc);
    } catch (err) {
      console.error("[sms-inbound] decrypt subaccount token", err);
    }
  }
  const valid = await validateTwilioSignature(req, rawBody, validateToken);
  if (!valid && process.env.NODE_ENV === "production") {
    return new NextResponse("invalid signature", { status: 403 });
  }

  // Resolve client by phone (best-effort — may be null)
  const cliQuery = await tenantCol(tenantId, "clients")
    .where("phone", "==", fromE164)
    .limit(1)
    .get();
  const clientId = cliQuery.empty ? null : cliQuery.docs[0].id;
  const client = cliQuery.empty ? null : (cliQuery.docs[0].data() as ClientDoc);

  // STOP / START keywords
  const isOptOut = isOptOutKeyword(body);
  const isOptIn = isOptInKeyword(body);
  if (isOptOut && cliQuery.docs[0]) {
    await cliQuery.docs[0].ref.update({ sms_consent: false, updated_at: now() });
    await writeAudit({
      action: "sms.opt_out",
      actorEmail: null,
      targetType: "client",
      targetId: clientId,
      after: { phone: fromE164, keyword: body.toUpperCase() },
    });
  } else if (isOptIn && cliQuery.docs[0]) {
    await cliQuery.docs[0].ref.update({ sms_consent: true, updated_at: now() });
  }

  // Find-or-create the conversation. Conversation key: client_phone (E.164).
  const convQuery = await tenantCol(tenantId, "conversations")
    .where("client_phone", "==", fromE164)
    .limit(1)
    .get();
  const preview = body.length > 120 ? body.slice(0, 117) + "…" : body;

  let convRef: FirebaseFirestore.DocumentReference;
  if (convQuery.empty) {
    convRef = tenantCol(tenantId, "conversations").doc();
    const convDoc: Omit<ConversationDoc, "created_at" | "updated_at"> & {
      created_at: ReturnType<typeof now>;
      updated_at: ReturnType<typeof now>;
    } = {
      tenant_id: tenantId,
      client_id: clientId,
      client_phone: fromE164,
      last_message_at: Timestamp.now(),
      last_message_preview: preview,
      last_direction: "inbound",
      unread_count_for_owner: 1,
      archived_at: null,
      created_at: now(),
      updated_at: now(),
    };
    await convRef.create(convDoc);
  } else {
    convRef = convQuery.docs[0].ref;
    const conv = convQuery.docs[0].data() as ConversationDoc;
    await convRef.update({
      client_id: clientId ?? conv.client_id ?? null,
      last_message_at: Timestamp.now(),
      last_message_preview: preview,
      last_direction: "inbound",
      unread_count_for_owner: (conv.unread_count_for_owner ?? 0) + 1,
      archived_at: null,
      updated_at: now(),
    });
  }

  // Append the message
  const msgRef = convRef.collection("messages").doc();
  const msgDoc: Omit<MessageDoc, "created_at"> & { created_at: ReturnType<typeof now> } = {
    tenant_id: tenantId,
    conversation_id: convRef.id,
    client_id: clientId,
    direction: "inbound",
    body,
    from_number: fromE164,
    to_number: toE164,
    twilio_sid: sid,
    status: "received",
    actor_user_id: null,
    actor_email: null,
    is_keyword: isOptOut || isOptIn,
    created_at: now(),
  };
  await msgRef.create(msgDoc);

  await writeAudit({
    action: "sms.inbound",
    actorEmail: null,
    targetType: "conversation",
    targetId: convRef.id,
    after: {
      client_id: clientId,
      from: fromE164,
      keyword: isOptOut ? "stop" : isOptIn ? "start" : null,
    },
  });

  // Optional auto-reply for STOP/START keywords (Twilio also handles STOP
  // at the carrier level — this is just confirmation).
  let reply = "";
  if (isOptOut) {
    reply = `${tenant.name}: You're unsubscribed from texts. Reply START to re-enable.`;
  } else if (isOptIn) {
    reply = `${tenant.name}: You're subscribed to texts. Reply STOP to unsubscribe.`;
  }
  // Suppress unused-warning when client lookup ran but isn't used directly
  void client;

  return new NextResponse(twiML(reply), { status: 200, headers: twiHeaders() });
}

function twiML(body: string): string {
  if (!body) return `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

function twiHeaders() {
  return { "Content-Type": "text/xml" };
}
