/**
 * DELETE /api/owner/social/connections/[platform]
 *
 * Disconnect (revoke) a social platform connection. Marks the doc as
 * status=revoked and clears the encrypted tokens.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PlatformSchema = z.enum(["meta", "x", "google_ads", "youtube", "tiktok"]);

export async function DELETE(
  _req: Request,
  rctx: { params: Promise<{ platform: string }> },
) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { platform } = await rctx.params;
  const parsed = PlatformSchema.safeParse(platform);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown platform." }, { status: 400 });
  }

  await tenantCol(ctx.tenant.id, "social_connections").doc(parsed.data).set(
    {
      status: "revoked",
      refresh_token_enc: null,
      access_token_enc: null,
      access_token_expires_at: null,
      updated_at: now(),
    },
    { merge: true },
  );

  await writeAudit({
    action: "admin.user_suspend",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "social_connection.revoke",
    targetId: parsed.data,
    after: { tenant_id: ctx.tenant.id, platform: parsed.data },
  }).catch((err) => console.error("[social-disconnect] audit", err));

  return NextResponse.json({ ok: true });
}
