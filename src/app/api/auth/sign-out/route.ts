/**
 * POST /api/auth/sign-out  — tenant-user sign-out.
 */

import { NextResponse } from "next/server";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getSessionUser, SESSION_COOKIE_NAME } from "@/lib/auth-server";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function init() {
  if (getApps().length > 0) return;
  const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saB64) {
    try {
      initializeApp({
        credential: cert(JSON.parse(Buffer.from(saB64, "base64").toString("utf8"))),
      });
      return;
    } catch {
      /* fallthrough */
    }
  }
  initializeApp({ credential: applicationDefault() });
}

export async function POST(req: Request) {
  init();
  const user = await getSessionUser();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  if (user) {
    try {
      await getAuth().revokeRefreshTokens(user.firebaseUid);
    } catch (err) {
      console.error("[tenant-sign-out] revokeRefreshTokens", err);
    }
    try {
      await writeAudit({
        action: "logout",
        actorEmail: user.email,
        actorUserId: user.firebaseUid,
        targetType: "session",
        after: { role: user.role, tenant_id: user.tenantId },
        ip,
        userAgent: ua,
      });
    } catch (err) {
      console.error("[tenant-sign-out] audit", err);
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    maxAge: 0,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return res;
}
