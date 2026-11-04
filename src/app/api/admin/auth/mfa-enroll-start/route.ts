/**
 * POST /api/admin/auth/mfa-enroll-start
 *
 * Step 1 of TOTP enrollment. The user re-enters their password (sensitive
 * action requires fresh auth). We sign in via REST to get an idToken, then
 * call accounts.mfaEnrollment:start to provision a TOTP secret.
 *
 * Returns: { sharedSecretKey, sessionInfo, otpauthUrl, qrSvg }
 *
 * The caller (EnrollTotp client component) renders the QR and asks for a
 * 6-digit verification code, which gets POSTed to mfa-enroll-finalize.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import QRCode from "qrcode";
import { getSessionUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  password: z.string().min(1).max(200),
});

const RATE = { capacity: 6, windowMs: 60 * 60 * 1000 };

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Rate limit per-user — prevents brute-force spam against the password
  // verification step
  const rl = checkRateLimit(`mfa-start:${session.firebaseUid}`, RATE);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Auth not configured." }, { status: 500 });
  }

  // Re-auth: get a fresh idToken via password
  let idToken: string;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session.email,
          password: parsed.data.password,
          returnSecureToken: true,
        }),
      },
    );
    if (!r.ok) {
      return NextResponse.json({ error: "Password is incorrect." }, { status: 401 });
    }
    const j = (await r.json()) as { idToken?: string };
    if (!j.idToken) {
      return NextResponse.json({ error: "Sign-in failed." }, { status: 500 });
    }
    idToken = j.idToken;
  } catch (err) {
    console.error("[mfa-enroll-start] re-auth failed", err);
    return NextResponse.json({ error: "Sign-in failed." }, { status: 500 });
  }

  // Start TOTP enrollment
  let totpSession: {
    sharedSecretKey: string;
    sessionInfo: string;
    verificationCodeLength?: number;
    periodSec?: number;
  };
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v2/accounts/mfaEnrollment:start?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          totpEnrollmentInfo: {},
        }),
      },
    );
    if (!r.ok) {
      const text = await r.text();
      console.error("[mfa-enroll-start] mfaEnrollment:start failed", r.status, text);
      return NextResponse.json(
        { error: "Could not start enrollment. Try again." },
        { status: 500 },
      );
    }
    const j = (await r.json()) as { totpSessionInfo?: typeof totpSession };
    if (!j.totpSessionInfo?.sharedSecretKey) {
      throw new Error("missing totpSessionInfo");
    }
    totpSession = j.totpSessionInfo;
  } catch (err) {
    console.error("[mfa-enroll-start] enrollment error", err);
    return NextResponse.json({ error: "Could not start enrollment." }, { status: 500 });
  }

  // Build otpauth:// URL and QR code SVG
  const issuer = "Aesthera";
  const account = encodeURIComponent(`${issuer}:${session.email}`);
  const otpauthUrl = `otpauth://totp/${account}?secret=${totpSession.sharedSecretKey}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${totpSession.verificationCodeLength ?? 6}&period=${totpSession.periodSec ?? 30}`;

  let qrSvg: string;
  try {
    qrSvg = await QRCode.toString(otpauthUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 240,
      color: { dark: "#1b2636", light: "#fdf9f3" },
    });
  } catch (err) {
    console.error("[mfa-enroll-start] qr render failed", err);
    qrSvg = "";
  }

  return NextResponse.json({
    sharedSecretKey: totpSession.sharedSecretKey,
    sessionInfo: totpSession.sessionInfo,
    otpauthUrl,
    qrSvg,
    // Pass-through the idToken so finalize doesn't need a second password prompt.
    // The token is HttpOnly via response cookie? No — we'll return as JSON,
    // client holds it in memory only for the duration of the enrollment.
    enrollmentToken: idToken,
  });
}
