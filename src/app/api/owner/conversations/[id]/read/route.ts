/**
 * POST /api/owner/conversations/[id]/read — clear unread count
 * POST /api/owner/conversations/[id]/archive — archive (or unarchive)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    archive: z.boolean().optional(),
  })
  .strict();

export async function POST(
  req: Request,
  rctx: { params: Promise<{ id: string }> },
) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (!["tenant_owner", "tenant_manager", "tenant_front_desk"].includes(ctx.user.role)) {
    return NextResponse.json({ error: "Inbox is owner / manager / front-desk only." }, { status: 403 });
  }
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

  const ref = tenantCol(ctx.tenant.id, "conversations").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    unread_count_for_owner: 0,
    updated_at: now(),
  };
  if (typeof parsed.data.archive === "boolean") {
    updates.archived_at = parsed.data.archive ? now() : null;
  }
  await ref.update(updates);
  return NextResponse.json({ ok: true });
}
