/**
 * PATCH /api/client/profile
 *
 * Lets the signed-in client update their own profile fields. Email is
 * the sign-in identifier and CANNOT be changed here (clinic admin only).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { normalizePhone } from "@/lib/sms";
import type { ClientDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    full_name: z.string().trim().min(1).max(120).optional(),
    preferred_name: z.string().trim().max(120).optional().nullable(),
    phone: z.string().trim().max(32).optional().nullable(),
    email_consent: z.boolean().optional(),
    sms_consent: z.boolean().optional(),
  })
  .strict();

export async function PATCH(req: Request) {
  const ctx = await requireTenantContextApi("tenant_client");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

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
  const data = parsed.data;

  // Normalize phone if provided
  if (data.phone) {
    const normalized = normalizePhone(data.phone);
    if (!normalized) {
      return NextResponse.json(
        { error: "Phone number doesn't look valid." },
        { status: 400 },
      );
    }
    data.phone = normalized;
  }

  const cliQuery = await tenantCol(ctx.tenant.id, "clients")
    .where("email", "==", ctx.user.email)
    .limit(1)
    .get();
  if (cliQuery.empty) {
    return NextResponse.json({ error: "Client record not found." }, { status: 404 });
  }
  const ref = cliQuery.docs[0].ref;
  const before = cliQuery.docs[0].data() as ClientDoc;

  await ref.update({
    ...data,
    updated_at: now(),
  });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;
  await writeAudit({
    action: "tenant.update",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "client_self",
    targetId: cliQuery.docs[0].id,
    before: {
      sms_consent: before.sms_consent,
      email_consent: before.email_consent,
    },
    after: data,
    ip,
    userAgent: ua,
  });

  return NextResponse.json({ ok: true });
}
