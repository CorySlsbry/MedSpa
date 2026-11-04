/**
 * POST /api/owner/providers
 *
 * Create + invite a provider for the current tenant.
 *
 * Steps:
 *   1. Validate input
 *   2. Find or create the Firebase user
 *   3. Set tenant_id + role=tenant_provider claims (preserves super_admin)
 *   4. Create the provider doc with ID = Firebase UID
 *   5. Send magic-link invite email
 *   6. Audit
 */

import { NextResponse } from "next/server";
import { EMAIL_FROM } from "@/lib/email";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol, setTenantClaims } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { checkResourceLimit } from "@/lib/tier-limits";
import type { ProviderDoc } from "@/lib/firestore-types";

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

const Create = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  full_name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  default_location_id: z.string().trim().max(60).optional(),
  send_invite: z.boolean().default(true),
});

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi("tenant_owner");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  init();

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = Create.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  // Tier limit check — active providers
  const activeProviders = await tenantCol(ctx.tenant.id, "providers")
    .where("is_active", "==", true)
    .count()
    .get()
    .then((s) => s.data().count)
    .catch(() => 0);
  const limitCheck = checkResourceLimit({
    tier: ctx.tenant.subscription_tier,
    field: "max_providers",
    current: activeProviders,
  });
  if (!limitCheck.ok) {
    return NextResponse.json(
      { error: limitCheck.message, upgrade_to: limitCheck.upgrade_to },
      { status: 402 },
    );
  }

  // Find or create Firebase user
  let providerUid: string;
  try {
    const existing = await getAuth().getUserByEmail(data.email);
    providerUid = existing.uid;
    // Block if already attached to a different tenant
    const claims = (existing.customClaims ?? {}) as { tenant_id?: string; role?: string };
    if (claims.tenant_id && claims.tenant_id !== ctx.tenant.id) {
      return NextResponse.json(
        { error: "That email is already attached to a different tenant." },
        { status: 409 },
      );
    }
  } catch (err) {
    if ((err as { code?: string }).code !== "auth/user-not-found") {
      console.error("[owner-providers-post] getUserByEmail", err);
      return NextResponse.json({ error: "Could not look up email." }, { status: 500 });
    }
    const tempPw = randomTempPassword();
    const user = await getAuth().createUser({
      email: data.email,
      emailVerified: false,
      password: tempPw,
      displayName: data.full_name,
    });
    providerUid = user.uid;
  }

  // Set tenant claims
  try {
    await setTenantClaims(providerUid, ctx.tenant.id, "tenant_provider");
  } catch (err) {
    console.error("[owner-providers-post] setTenantClaims", err);
    return NextResponse.json({ error: "Could not assign provider role." }, { status: 500 });
  }

  // Create provider doc (idempotent — set with merge)
  try {
    const providerDoc: Omit<ProviderDoc, "created_at" | "updated_at"> & {
      created_at: ReturnType<typeof now>;
      updated_at: ReturnType<typeof now>;
    } = {
      tenant_id: ctx.tenant.id,
      user_id: providerUid,
      email: data.email,
      full_name: data.full_name,
      title: data.title || null,
      phone: data.phone || null,
      is_active: true,
      scheduling_color: assignSchedulingColor(providerUid),
      default_location_id: data.default_location_id || null,
      ics_token: randomBytes(24).toString("base64url"),
      created_at: now(),
      updated_at: now(),
    };
    await tenantCol(ctx.tenant.id, "providers").doc(providerUid).set(providerDoc, { merge: true });
  } catch (err) {
    console.error("[owner-providers-post] doc create", err);
    return NextResponse.json({ error: "Could not create provider record." }, { status: 500 });
  }

  // Send invite (best-effort)
  if (data.send_invite) {
    try {
      const baseUrl =
        process.env.NEXT_PUBLIC_SITE_URL ||
        `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;
      const link = await getAuth().generateSignInWithEmailLink(data.email, {
        url: `${baseUrl}/api/auth/callback?email=${encodeURIComponent(data.email)}`,
        handleCodeInApp: true,
      });
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: EMAIL_FROM.support,
            to: [data.email],
            subject: `You've been invited to ${ctx.tenant.name} on Aesthera`,
            html: `
              <p>${escapeHtml(data.full_name)}, you've been added as a provider at <strong>${escapeHtml(ctx.tenant.name)}</strong>.</p>
              <p>Click below to set up your account.</p>
              <p><a href="${link}" style="display:inline-block;padding:12px 24px;background:#b98f42;color:#1b2636;text-decoration:none;border-radius:8px;font-weight:600;">Sign in →</a></p>
              <p style="font-size:12px;color:#888;">Link expires in 15 minutes.</p>
            `,
          }),
        });
      } else {
        console.log("[owner-providers-post] (no resend key) link for", data.email, "→", link);
      }
    } catch (err) {
      console.error("[owner-providers-post] invite send", err);
    }
  }

  // Audit
  try {
    await writeAudit({
      action: "admin.user_create",
      actorEmail: ctx.user.email,
      actorUserId: ctx.user.firebaseUid,
      targetType: "provider",
      targetId: providerUid,
      after: { email: data.email, name: data.full_name, tenant_id: ctx.tenant.id, invited: data.send_invite },
      ip,
      userAgent: ua,
    });
  } catch (err) {
    console.error("[owner-providers-post] audit", err);
  }

  return NextResponse.json({ ok: true, providerUid });
}

function randomTempPassword(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < arr.length; i++) out += charset[arr[i] % charset.length];
  return out + "!Aa1";
}

function assignSchedulingColor(seed: string): string {
  const palette = ["#07667a", "#b98f42", "#2e4057", "#06824a", "#8a1c1c", "#04738c"];
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
