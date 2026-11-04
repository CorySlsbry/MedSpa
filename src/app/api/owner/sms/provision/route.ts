/**
 * POST /api/owner/sms/provision
 *
 * One-click Twilio subaccount + phone number provisioning for the
 * tenant. Idempotent: if already provisioned, returns the existing
 * number. Otherwise:
 *   1. Creates a Twilio subaccount (master account pays for usage)
 *   2. Searches for a number in the requested area code
 *   3. Purchases it, points SmsUrl at /api/sms/inbound
 *   4. Persists subaccount SID + encrypted auth_token + number on
 *      the TenantDoc
 *
 * Owner-only. Requires master TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { encryptToken } from "@/lib/oauth";
import {
  createTwilioSubaccount,
  findAvailableNumber,
  purchaseNumber,
} from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    area_code: z
      .string()
      .trim()
      .regex(/^\d{3}$/, "Area code must be 3 digits.")
      .optional(),
  })
  .strict();

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  // Already provisioned? Just return.
  if (ctx.tenant.twilio_subaccount_sid && ctx.tenant.twilio_phone_number) {
    return NextResponse.json({
      ok: true,
      already_provisioned: true,
      phone_number: ctx.tenant.twilio_phone_number,
      subaccount_sid: ctx.tenant.twilio_subaccount_sid,
    });
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return NextResponse.json(
      { error: "Master Twilio credentials are not configured on the platform." },
      { status: 503 },
    );
  }
  if (!process.env.OAUTH_TOKEN_KEY) {
    return NextResponse.json(
      { error: "OAUTH_TOKEN_KEY not set — cannot encrypt subaccount token." },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;
  const inboundUrl = `${baseUrl}/api/sms/inbound`;

  try {
    // 1. Subaccount
    const sub = await createTwilioSubaccount(`Aesthera · ${ctx.tenant.name}`);

    // 2. Find a number
    const e164 = await findAvailableNumber(sub.sid, sub.auth_token, parsed.data.area_code);

    // 3. Purchase + configure webhook
    const bought = await purchaseNumber(
      sub.sid,
      sub.auth_token,
      e164,
      inboundUrl,
      ctx.tenant.name,
    );

    // 4. Persist
    const encToken = encryptToken(sub.auth_token);
    await db().collection("tenants").doc(ctx.tenant.id).update({
      twilio_subaccount_sid: sub.sid,
      twilio_subaccount_auth_token_enc: encToken,
      twilio_phone_number: bought.phone_number,
      updated_at: now(),
    });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const ua = req.headers.get("user-agent") || null;
    await writeAudit({
      action: "tenant.update",
      actorEmail: ctx.user.email,
      actorUserId: ctx.user.firebaseUid,
      targetType: "tenant",
      targetId: ctx.tenant.id,
      after: {
        twilio_subaccount_provisioned: true,
        phone_number: bought.phone_number,
      },
      ip,
      userAgent: ua,
    });

    return NextResponse.json({
      ok: true,
      phone_number: bought.phone_number,
      subaccount_sid: sub.sid,
    });
  } catch (err) {
    console.error("[sms-provision]", err);
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg.includes("No available") ? 409 : 500 },
    );
  }
}
