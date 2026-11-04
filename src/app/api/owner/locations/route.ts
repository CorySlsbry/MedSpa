/**
 * POST /api/owner/locations  — create a location for the current tenant
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { checkResourceLimit } from "@/lib/tier-limits";
import type { LocationDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  name: z.string().trim().min(1).max(120),
  address_line_1: z.string().trim().max(200).optional(),
  address_line_2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(60).optional(),
  postal_code: z.string().trim().max(20).optional(),
  country: z.string().trim().max(60).default("US"),
  phone: z.string().trim().max(40).optional(),
  timezone: z.string().trim().max(60).default("America/Denver"),
  is_primary: z.boolean().default(false),
});

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Create.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  // Tier limit check (resource = active locations)
  const activeCount = await tenantCol(ctx.tenant.id, "locations")
    .where("is_active", "==", true)
    .count()
    .get()
    .then((s) => s.data().count)
    .catch(() => 0);
  const limit = checkResourceLimit({
    tier: ctx.tenant.subscription_tier,
    field: "max_locations",
    current: activeCount,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: limit.message, upgrade_to: limit.upgrade_to },
      { status: 402 },
    );
  }

  try {
    const id = await db().runTransaction(async (trx) => {
      // If marking primary, unset existing primary atomically
      if (data.is_primary) {
        const existing = await trx.get(
          tenantCol(ctx.tenant.id, "locations").where("is_primary", "==", true),
        );
        for (const doc of existing.docs) {
          trx.update(doc.ref, { is_primary: false, updated_at: now() });
        }
      }
      const ref = tenantCol(ctx.tenant.id, "locations").doc();
      const doc: Omit<LocationDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        name: data.name,
        address_line_1: data.address_line_1 || null,
        address_line_2: data.address_line_2 || null,
        city: data.city || null,
        state: data.state || null,
        postal_code: data.postal_code || null,
        country: data.country,
        phone: data.phone || null,
        timezone: data.timezone,
        is_primary: data.is_primary,
        is_active: true,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(ref, doc);
      writeAuditInTx(trx, {
        action: "admin.user_create",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "location",
        targetId: ref.id,
        after: { name: data.name, tenant_id: ctx.tenant.id },
        ip,
        userAgent: ua,
      });
      return ref.id;
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("[owner-locations-post]", err);
    return NextResponse.json({ error: "Could not create location." }, { status: 500 });
  }
}
