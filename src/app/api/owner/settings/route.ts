/**
 * PATCH /api/owner/settings  — update tenant info that the owner controls.
 *
 * Owner can change: name, timezone, primary_color (branding), logo_url.
 * Owner CANNOT change: subscription_tier, status, owner_email, slug
 * (those are super-admin / Stripe-controlled).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { normalizePhone } from "@/lib/sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timezone: z.string().trim().max(60).optional(),
  primary_color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex (e.g. #b98f42).")
    .nullable()
    .optional(),
  logo_url: z
    .string()
    .trim()
    .url("Logo must be a valid URL.")
    .max(500)
    .nullable()
    .optional(),
  twilio_phone_number: z
    .string()
    .trim()
    .max(32)
    .nullable()
    .optional(),
  google_review_url: z
    .string()
    .trim()
    .url("Google review URL must be a valid URL.")
    .max(500)
    .nullable()
    .optional(),
});

export async function PATCH(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Patch.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  // Normalize Twilio number to E.164 if provided (and non-empty)
  if (parsed.data.twilio_phone_number !== undefined && parsed.data.twilio_phone_number !== null) {
    const trimmed = parsed.data.twilio_phone_number.trim();
    if (trimmed === "") {
      parsed.data.twilio_phone_number = null;
    } else {
      const normalized = normalizePhone(trimmed);
      if (!normalized) {
        return NextResponse.json(
          { error: "Twilio number must be a valid phone (e.g. +15551234567)." },
          { status: 400 },
        );
      }
      parsed.data.twilio_phone_number = normalized;
    }
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    await db().runTransaction(async (trx) => {
      const ref = db().collection("tenants").doc(ctx.tenant.id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Tenant not found.");
      trx.update(ref, { ...parsed.data, updated_at: now() });
      writeAuditInTx(trx, {
        action: "tenant.update",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "tenant",
        targetId: ctx.tenant.id,
        after: parsed.data,
        ip,
        userAgent: ua,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg === "Tenant not found." ? 404 : 500 },
    );
  }
}
