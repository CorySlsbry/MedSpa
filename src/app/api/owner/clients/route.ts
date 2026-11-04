/**
 * POST /api/owner/clients  — add a single client to the clinic's roster.
 *
 * Phase 5 will add bulk CSV import + a self-serve booking widget that
 * creates a client doc on first booking. For now this is the manual path.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import { checkResourceLimit } from "@/lib/tier-limits";
import type { ClientDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  full_name: z.string().trim().min(1).max(160),
  preferred_name: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  date_of_birth: z.string().trim().max(20).optional(),
  default_location_id: z.string().trim().max(60).optional(),
  email_consent: z.boolean().default(true),
  sms_consent: z.boolean().default(false),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
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

  // Tier limit — total client records
  const totalClients = await tenantCol(ctx.tenant.id, "clients")
    .count()
    .get()
    .then((s) => s.data().count)
    .catch(() => 0);
  const cliLimit = checkResourceLimit({
    tier: ctx.tenant.subscription_tier,
    field: "max_active_clients",
    current: totalClients,
  });
  if (!cliLimit.ok) {
    return NextResponse.json(
      { error: cliLimit.message, upgrade_to: cliLimit.upgrade_to },
      { status: 402 },
    );
  }

  try {
    const id = await db().runTransaction(async (trx) => {
      // Check for existing client with same email
      const existing = await trx.get(
        tenantCol(ctx.tenant.id, "clients").where("email", "==", data.email).limit(1),
      );
      if (!existing.empty) {
        throw new Error("A client with that email already exists.");
      }

      const ref = tenantCol(ctx.tenant.id, "clients").doc();
      const dobIso = data.date_of_birth || null;
      const doc: Omit<ClientDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        email: data.email,
        full_name: data.full_name,
        phone: data.phone || null,
        date_of_birth: dobIso,
        preferred_name: data.preferred_name || null,
        default_location_id: data.default_location_id || null,
        email_consent: data.email_consent,
        sms_consent: data.sms_consent,
        hipaa_consent_signed_at: null,
        tags: data.tags,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(ref, doc);
      writeAuditInTx(trx, {
        action: "contact.create",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "client",
        targetId: ref.id,
        after: { email_domain: data.email.split("@")[1], tenant_id: ctx.tenant.id },
        ip,
        userAgent: ua,
      });
      return ref.id;
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json(
      { error: msg },
      { status: msg.startsWith("A client") ? 409 : 500 },
    );
  }
}

// Phase 5: bulk import would go in a sibling /import endpoint. The Timestamp
// import above is reserved for that future code path so the type stays warm.
void Timestamp;
