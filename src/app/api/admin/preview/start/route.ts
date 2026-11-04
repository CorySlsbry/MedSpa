/**
 * POST /api/admin/preview/start
 *
 * Start a "View as" preview session for a super-admin. Sets the
 * aesthera-view-as cookie with {role, tenantId}. The cookie is HttpOnly
 * and only meaningful when the session cookie is also a super_admin
 * session — requireTenantContext re-checks the user's role on every
 * request, so a non-super-admin holding this cookie has no effect.
 *
 * Returns the destination URL so the client can redirect.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth-server";
import { writeAudit } from "@/lib/audit";
import { PREVIEW_COOKIE_NAME } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  role: z.enum([
    "tenant_owner",
    "tenant_manager",
    "tenant_provider",
    "tenant_front_desk",
    "tenant_client",
  ]),
  tenantId: z.string().trim().min(1).max(120),
});

const ROLE_TO_PORTAL: Record<string, string> = {
  tenant_owner: "/owner",
  tenant_manager: "/manager",
  tenant_provider: "/provider",
  tenant_front_desk: "/front-desk",
  tenant_client: "/client",
};

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (user.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const { role, tenantId } = parsed.data;

  const portal = ROLE_TO_PORTAL[role] ?? "/admin";
  const cookieValue = JSON.stringify({ role, tenantId });

  void writeAudit({
    action: "admin.user_create", // closest existing action; "preview.start" not in enum yet
    actorEmail: user.email,
    actorUserId: user.firebaseUid,
    targetType: "tenant.preview",
    targetId: tenantId,
    after: { role, tenant_id: tenantId },
  }).catch((err) => console.error("[admin-preview-start] audit", err));

  const res = NextResponse.json({ ok: true, redirect: portal });
  res.cookies.set(PREVIEW_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // 4-hour ceiling so a forgotten preview doesn't outlive the work session
    maxAge: 4 * 60 * 60,
  });
  return res;
}
