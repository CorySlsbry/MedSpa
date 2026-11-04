/**
 * POST /api/owner/onboarding/complete
 *
 * Marks the tenant onboarded_at = now() so future logins skip the wizard.
 * Owner-only.
 */

import { NextResponse } from "next/server";
import { db, now } from "@/lib/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  await db().collection("tenants").doc(ctx.tenant.id).update({
    onboarded_at: now(),
    updated_at: now(),
  });

  await writeAudit({
    action: "admin.user_create",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "tenant.onboarded",
    targetId: ctx.tenant.id,
  }).catch((err) => console.error("[onboarding-complete] audit", err));

  return NextResponse.json({ ok: true });
}
