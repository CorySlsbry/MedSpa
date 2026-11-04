/**
 * POST /api/admin/auth/mfa-enroll-finalize
 *
 * Step 2 of TOTP enrollment. Caller submits the 6-digit code from their
 * authenticator app + the sessionInfo returned from mfa-enroll-start.
 *
 * On success: writes mfa_enrolled_at to users/{uid}, mints a NEW session
 * cookie with AAL2 (so the user doesn't need to sign back in), audits.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionCookie,
  getSessionUser,
  SESSION_COOKIE_NAME,
} from "@/lib/auth-server";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  enrollmentToken: z.string().min(20),
  sessionInfo: z.string().min(8),
  verificationCode: z.string().regex(/^\d{6}$/, "Must be 6 digits."),
  displayName: z.string().trim().max(100).optional(),
});

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Auth not configured." }, { status: 500 });
  }

  let newIdToken: string;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v2/accounts/mfaEnrollment:finalize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken: parsed.data.enrollmentToken,
          displayName: parsed.data.displayName || "Authenticator",
          totpVerificationInfo: {
            sessionInfo: parsed.data.sessionInfo,
            verificationCode: parsed.data.verificationCode,
          },
        }),
      },
    );
    if (!r.ok) {
      const text = await r.text();
      console.error("[mfa-enroll-finalize] failed", r.status, text);
      return NextResponse.json(
        { error: "Code didn't match. Try again — codes refresh every 30s." },
        { status: 401 },
      );
    }
    const j = (await r.json()) as { idToken?: string };
    if (!j.idToken) throw new Error("missing idToken in finalize response");
    newIdToken = j.idToken;
  } catch (err) {
    console.error("[mfa-enroll-finalize] error", err);
    return NextResponse.json({ error: "Enrollment failed." }, { status: 500 });
  }

  // Mint new session cookie (carries AAL2 from the new idToken)
  let sessionCookie: { value: string; maxAgeSeconds: number };
  try {
    sessionCookie = await createSessionCookie(newIdToken);
  } catch (err) {
    console.error("[mfa-enroll-finalize] session mint failed", err);
    return NextResponse.json({ error: "Session refresh failed." }, { status: 500 });
  }

  // Update Firestore + audit
  try {
    await db()
      .collection("users")
      .doc(session.firebaseUid)
      .set(
        { mfa_enrolled_at: now(), updated_at: now() },
        { merge: true },
      );
    await writeAudit({
      action: "admin.user_create", // re-using closest action; could add 'mfa.enroll'
      actorEmail: session.email,
      actorUserId: session.firebaseUid,
      targetType: "mfa_factor",
      targetId: session.firebaseUid,
      after: { factor: "totp" },
    });
  } catch (err) {
    console.error("[mfa-enroll-finalize] audit/firestore", err);
  }

  const res = NextResponse.json({ ok: true, redirect: "/admin/security?enrolled=1" });
  res.cookies.set(SESSION_COOKIE_NAME, sessionCookie.value, {
    maxAge: sessionCookie.maxAgeSeconds,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return res;
}
