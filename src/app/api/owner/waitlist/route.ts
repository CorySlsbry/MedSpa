/**
 * GET  /api/owner/waitlist  — list active entries
 * POST /api/owner/waitlist  — add a client to the waitlist
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now, toDate } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import type { ClientDoc, WaitlistDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z
  .object({
    client_id: z.string().min(1),
    service_name: z.string().trim().min(1).max(120),
    location_id: z.string().nullable().optional(),
    provider_id: z.string().nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    preferred_days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  })
  .strict();

export async function GET(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!["tenant_owner", "tenant_manager", "tenant_front_desk"].includes(ctx.user.role)) {
    return NextResponse.json({ error: "Waitlist is owner / manager / front-desk only." }, { status: 403 });
  }

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("inactive") === "true";

  const snap = await tenantCol(ctx.tenant.id, "waitlist")
    .orderBy("created_at", "desc")
    .limit(200)
    .get()
    .catch(() => null);
  if (!snap) return NextResponse.json({ ok: true, entries: [] });

  const clientIds = new Set<string>();
  for (const d of snap.docs) clientIds.add((d.data() as WaitlistDoc).client_id);
  const clientMap = new Map<string, string>();
  await Promise.all(
    [...clientIds].map(async (cid) => {
      const cs = await tenantCol(ctx.tenant.id, "clients").doc(cid).get().catch(() => null);
      if (cs && cs.exists) clientMap.set(cid, (cs.data() as ClientDoc).full_name);
    }),
  );

  const entries = snap.docs
    .map((d) => {
      const w = d.data() as WaitlistDoc;
      return {
        id: d.id,
        client_id: w.client_id,
        client_name: clientMap.get(w.client_id) ?? null,
        service_name: w.service_name,
        location_id: w.location_id,
        provider_id: w.provider_id,
        notes: w.notes,
        preferred_days: w.preferred_days,
        status: w.status,
        notified_at: toDate(w.notified_at),
        created_at: toDate(w.created_at),
      };
    })
    .filter((e) => (includeInactive ? true : e.status === "active" || e.status === "notified"));

  return NextResponse.json({ ok: true, entries });
}

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!["tenant_owner", "tenant_manager", "tenant_front_desk"].includes(ctx.user.role)) {
    return NextResponse.json({ error: "Waitlist is owner / manager / front-desk only." }, { status: 403 });
  }

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
      // Verify client exists
      const cliRef = tenantCol(ctx.tenant.id, "clients").doc(data.client_id);
      const cliSnap = await trx.get(cliRef);
      if (!cliSnap.exists) throw new Error("Client not found.");

      const ref = tenantCol(ctx.tenant.id, "waitlist").doc();
      const doc: Omit<WaitlistDoc, "created_at" | "updated_at"> & {
        created_at: ReturnType<typeof now>;
        updated_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        client_id: data.client_id,
        service_name: data.service_name,
        location_id: data.location_id ?? null,
        provider_id: data.provider_id ?? null,
        notes: data.notes ?? null,
        preferred_days: data.preferred_days ?? [],
        status: "active",
        notified_at: null,
        booked_appointment_id: null,
        created_at: now(),
        updated_at: now(),
      };
      trx.create(ref, doc);
      writeAuditInTx(trx, {
        action: "waitlist.add",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "waitlist",
        targetId: ref.id,
        after: {
          client_id: data.client_id,
          service: data.service_name,
        },
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
      { status: msg === "Client not found." ? 404 : 500 },
    );
  }
}
