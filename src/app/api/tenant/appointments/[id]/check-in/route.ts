/**
 * POST /api/tenant/appointments/[id]/check-in
 *
 * Front-desk (and manager / owner) action to mark an appointment as
 * checked in. Updates appointment.status from "scheduled" to
 * "checked_in", stamps checked_in_at, and writes an audit row.
 *
 * Authorization: any tenant role except tenant_client. The appointment
 * must belong to the actor's tenant — enforced by `tenantCol(...).doc(id)`
 * which scopes the read.
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ACTORS = new Set([
  "tenant_owner",
  "tenant_manager",
  "tenant_provider",
  "tenant_front_desk",
]);

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ALLOWED_ACTORS.has(ctx.user.role)) {
    return NextResponse.json(
      { error: "Your role can't check clients in." },
      { status: 403 },
    );
  }

  const { id } = await params;
  const apptRef = tenantCol(ctx.user.tenantId!, "appointments").doc(id);
  const snap = await apptRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 });
  }
  const data = snap.data() as { status?: string };
  if (data.status === "checked_in") {
    return NextResponse.json({ ok: true, already: true });
  }
  if (data.status !== "scheduled") {
    return NextResponse.json(
      {
        error: `Can't check in an appointment with status "${data.status ?? "unknown"}".`,
      },
      { status: 409 },
    );
  }

  await apptRef.update({
    status: "checked_in",
    checked_in_at: now(),
    updated_at: now(),
  });

  void writeAudit({
    action: "appointment.update",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "appointment.check_in",
    targetId: id,
    before: { status: data.status },
    after: { status: "checked_in" },
  }).catch((err) => console.error("[appt-check-in] audit", err));

  return NextResponse.json({ ok: true, status: "checked_in" });
}
