/**
 * GET  /api/owner/menu-config — read the per-tenant menu config.
 * PATCH /api/owner/menu-config — update menu_overrides + menu_lock_owner_only.
 *
 * Authorization:
 *   - GET: any tenant role (the nav itself reads this to render).
 *   - PATCH: tenant_owner always; tenant_manager unless menu_lock_owner_only is true.
 *
 * The `menu_overrides` map keys are absolute paths ("/manager/inventory")
 * and values are arrays of roles that should see that item. Sidebar
 * components compose this with the static defaults — absent key = default
 * visibility from NAV_BY_ROLE.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import type { UserRole } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RoleEnum = z.enum([
  "tenant_owner",
  "tenant_manager",
  "tenant_provider",
  "tenant_front_desk",
  "tenant_client",
]);

const Patch = z.object({
  menu_overrides: z.record(z.string(), z.array(RoleEnum)).optional(),
  menu_lock_owner_only: z.boolean().optional(),
});

export async function GET() {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  return NextResponse.json({
    ok: true,
    menu_overrides: ctx.tenant.menu_overrides ?? {},
    menu_lock_owner_only: ctx.tenant.menu_lock_owner_only ?? false,
  });
}

export async function PATCH(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (ctx.user.role !== "tenant_owner" && ctx.user.role !== "tenant_manager") {
    return NextResponse.json({ error: "Only owners and managers can edit the menu config." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = Patch.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const tenantRef = db().collection("tenants").doc(ctx.user.tenantId!);
  const update: Record<string, unknown> = {
    updated_at: now(),
  };

  // Lock toggle is owner-only — managers can change menu_overrides but
  // never the lock itself.
  if (parsed.data.menu_lock_owner_only !== undefined) {
    if (ctx.user.role !== "tenant_owner") {
      return NextResponse.json({ error: "Only the owner can toggle the menu lock." }, { status: 403 });
    }
    update.menu_lock_owner_only = parsed.data.menu_lock_owner_only;
  }

  if (parsed.data.menu_overrides !== undefined) {
    // If lock is on AND actor is manager, deny
    if (
      ctx.user.role === "tenant_manager" &&
      (ctx.tenant.menu_lock_owner_only ?? false)
    ) {
      return NextResponse.json(
        { error: "The menu lock is on. Only the owner can change menu visibility." },
        { status: 403 },
      );
    }
    update.menu_overrides = parsed.data.menu_overrides as Record<string, UserRole[]>;
  }

  await tenantRef.update(update);

  void writeAudit({
    action: "tenant.update",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "tenant.menu_config",
    targetId: ctx.user.tenantId,
    before: {
      menu_overrides: ctx.tenant.menu_overrides ?? null,
      menu_lock_owner_only: ctx.tenant.menu_lock_owner_only ?? false,
    },
    after: {
      menu_overrides: update.menu_overrides ?? ctx.tenant.menu_overrides ?? null,
      menu_lock_owner_only:
        update.menu_lock_owner_only ?? ctx.tenant.menu_lock_owner_only ?? false,
    },
  }).catch((err) => console.error("[owner-menu-config] audit", err));

  return NextResponse.json({ ok: true });
}
