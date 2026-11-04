/**
 * POST /api/owner/client-packages/[id]/redeem
 *
 * Decrements sessions_remaining (typically by 1) and writes a redemption
 * row. Optional appointment_id ties the draw to a specific visit.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAuditInTx } from "@/lib/audit";
import type { ClientPackageDoc, PackageRedemptionDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    sessions: z.number().int().min(1).max(20).default(1),
    appointment_id: z.string().optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .strict();

export async function POST(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const { id } = await rctx.params;

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
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  try {
    const balanceAfter = await db().runTransaction<number>(async (trx) => {
      const ref = tenantCol(ctx.tenant.id, "client_packages").doc(id);
      const snap = await trx.get(ref);
      if (!snap.exists) throw new Error("Not found.");
      const pkg = snap.data() as ClientPackageDoc;
      if (pkg.expires_at && pkg.expires_at.toDate().getTime() < Date.now()) {
        throw new Error("Package has expired.");
      }
      if (pkg.sessions_remaining < parsed.data.sessions) {
        throw new Error(
          `Only ${pkg.sessions_remaining} session(s) remaining; cannot redeem ${parsed.data.sessions}.`,
        );
      }
      const newBalance = pkg.sessions_remaining - parsed.data.sessions;
      trx.update(ref, {
        sessions_remaining: newBalance,
        updated_at: now(),
      });
      const redemptionRef = ref.collection("redemptions").doc();
      const redDoc: Omit<PackageRedemptionDoc, "created_at"> & {
        created_at: ReturnType<typeof now>;
      } = {
        tenant_id: ctx.tenant.id,
        client_package_id: id,
        client_id: pkg.client_id,
        appointment_id: parsed.data.appointment_id ?? null,
        sessions_used: parsed.data.sessions,
        balance_after: newBalance,
        reason: parsed.data.reason ?? null,
        actor_user_id: ctx.user.firebaseUid,
        actor_email: ctx.user.email,
        created_at: now(),
      };
      trx.create(redemptionRef, redDoc);
      writeAuditInTx(trx, {
        action: "package.redeem",
        actorEmail: ctx.user.email,
        actorUserId: ctx.user.firebaseUid,
        targetType: "client_package",
        targetId: id,
        before: { sessions_remaining: pkg.sessions_remaining },
        after: {
          sessions_remaining: newBalance,
          appointment_id: parsed.data.appointment_id ?? null,
        },
        ip,
        userAgent: ua,
      });
      return newBalance;
    });
    return NextResponse.json({ ok: true, sessions_remaining: balanceAfter });
  } catch (err) {
    const msg = (err as Error).message;
    let status = 500;
    if (msg === "Not found.") status = 404;
    else if (msg.includes("expired") || msg.includes("Only ")) status = 409;
    return NextResponse.json({ error: msg }, { status });
  }
}
