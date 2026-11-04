/**
 * POST /api/owner/services  — create a service in the tenant catalog
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import type { ServiceDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum([
    "injectables",
    "facial",
    "laser",
    "body",
    "iv_therapy",
    "wellness",
    "consultation",
    "other",
  ]).default("other"),
  duration_minutes: z.number().int().min(5).max(480),
  price_cents: z.number().int().min(0).max(10_000_000).optional(),
  description: z.string().trim().max(2000).optional(),
  consumes: z
    .array(
      z.object({
        product_id: z.string().min(1),
        qty: z.number().positive().max(10_000),
      }),
    )
    .max(20)
    .optional(),
  deposit_cents: z.number().int().min(0).max(10_000_000).optional().nullable(),
  recommended_rebook_days: z.number().int().min(1).max(365).optional().nullable(),
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

  try {
    const id = await db().runTransaction<string>(async (trx) => {
      // Validate consumes.product_id all exist before writing — keeps
      // the catalog referentially clean. Reads happen before writes.
      if (data.consumes && data.consumes.length > 0) {
        const productSnaps = await Promise.all(
          data.consumes.map((c) =>
            trx.get(tenantCol(ctx.tenant.id, "products").doc(c.product_id)),
          ),
        );
        const missing = productSnaps.findIndex((s) => !s.exists);
        if (missing >= 0) {
          throw new Error(`Product not found: ${data.consumes[missing].product_id}`);
        }
      }

      const ref = tenantCol(ctx.tenant.id, "services").doc();
      const doc: Omit<ServiceDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        name: data.name,
        category: data.category,
        duration_minutes: data.duration_minutes,
        price_cents: data.price_cents ?? null,
        description: data.description ?? null,
        is_active: true,
        consumes: data.consumes ?? null,
        deposit_cents: data.deposit_cents ?? null,
        recommended_rebook_days: data.recommended_rebook_days ?? null,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(ref, doc);
      writeAuditInTx(trx, {
        action: "service.create",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "service",
        targetId: ref.id,
        after: { name: data.name, category: data.category },
        ip,
        userAgent: ua,
      });
      return ref.id;
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith("Product not found")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[owner-services-post]", err);
    return NextResponse.json({ error: "Could not create service." }, { status: 500 });
  }
}
