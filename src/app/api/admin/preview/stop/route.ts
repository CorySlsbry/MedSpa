/**
 * POST /api/admin/preview/stop
 *
 * Exit "View as" preview. Clears the aesthera-view-as cookie and returns
 * the user back to /admin. Audited.
 */

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-server";
import { writeAudit } from "@/lib/audit";
import { PREVIEW_COOKIE_NAME } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (user.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  void writeAudit({
    action: "admin.user_create",
    actorEmail: user.email,
    actorUserId: user.firebaseUid,
    targetType: "tenant.preview.stop",
    targetId: null,
  }).catch((err) => console.error("[admin-preview-stop] audit", err));

  const res = NextResponse.json({ ok: true, redirect: "/admin" });
  res.cookies.set(PREVIEW_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
