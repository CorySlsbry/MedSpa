/**
 * POST /api/admin/integrations/google/disconnect — revoke the platform
 * Google connection. Calls Google's revoke endpoint best-effort, then
 * deletes the platform_oauth/google doc.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth-server";
import { ADMIN_GOOGLE_DOC, type AdminGoogleDoc } from "@/lib/admin-google";
import { decryptToken } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getSessionUser();
  if (!user || user.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ref = db().doc(ADMIN_GOOGLE_DOC);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ ok: true, was_connected: false });

  const data = snap.data() as AdminGoogleDoc;
  const accessToken = (() => {
    try {
      return decryptToken(data.access_token_enc);
    } catch {
      return null;
    }
  })();

  if (accessToken) {
    // Best-effort revoke — if it fails we still drop the doc
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
    }).catch(() => {});
  }

  await ref.delete();
  await writeAudit({
    action: "admin.user_suspend",
    actorEmail: user.email,
    actorUserId: user.firebaseUid,
    targetType: "platform_oauth.google",
    targetId: data.account_email,
    after: { disconnected: true },
  });

  return NextResponse.json({ ok: true });
}
