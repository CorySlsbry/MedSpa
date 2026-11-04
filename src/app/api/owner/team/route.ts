/**
 * GET /api/owner/team — list users in the current tenant.
 *
 * Source of truth is Firebase Auth custom claims (tenant_id + role). We
 * use listUsers() on the admin SDK + filter by claim. This avoids
 * needing to denormalize tenant_id into every UserDoc and keeps the auth
 * universe authoritative.
 *
 * Owner + manager can call this. Returns a row per user with email, role,
 * status, MFA-enrolled flag, and last sign-in. Used by the
 * team-management page.
 */

import { NextResponse } from "next/server";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { db, toDate } from "@/lib/firestore";
import type { UserDoc } from "@/lib/firestore-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_VIEWERS = ["tenant_owner", "tenant_manager"] as const;

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

export async function GET() {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  if (!ALLOWED_VIEWERS.includes(ctx.user.role as (typeof ALLOWED_VIEWERS)[number])) {
    return NextResponse.json(
      { error: "Only owner and manager can view the team." },
      { status: 403 },
    );
  }

  init();
  const tenantId = ctx.user.tenantId!;

  // listUsers paginates; cap at 1000 for now (more than any single tenant
  // will plausibly have). When that ceiling becomes real we can iterate.
  const list = await getAuth().listUsers(1000);
  const matches = list.users.filter((u) => {
    const claims = (u.customClaims ?? {}) as { tenant_id?: string };
    return claims.tenant_id === tenantId;
  });

  // For each match, hydrate display data from the Firestore user doc when
  // it exists (display_name + last_seen_at). Fall back to Firebase Auth
  // metadata when the doc is missing — common for freshly-provisioned users.
  const userIds = matches.map((u) => u.uid);
  const docSnaps = await Promise.all(
    userIds.map((uid) => db().collection("users").doc(uid).get().catch(() => null)),
  );
  const docMap = new Map<string, UserDoc>();
  docSnaps.forEach((s, i) => {
    if (s?.exists) docMap.set(userIds[i], s.data() as UserDoc);
  });

  const users = matches.map((u) => {
    const claims = (u.customClaims ?? {}) as { role?: string };
    const doc = docMap.get(u.uid);
    return {
      id: u.uid,
      email: u.email ?? doc?.email ?? "(no email)",
      displayName: u.displayName ?? doc?.display_name ?? null,
      role: claims.role ?? doc?.role ?? "tenant_client",
      status: doc?.status ?? (u.disabled ? "suspended" : "active"),
      mfaEnrolled:
        !!doc?.mfa_enrolled_at ||
        (u.multiFactor?.enrolledFactors?.length ?? 0) > 0,
      lastSeenAt:
        toDate(doc?.last_seen_at ?? null)?.toISOString() ??
        u.metadata?.lastSignInTime ??
        null,
      createdAt: u.metadata?.creationTime ?? null,
    };
  });

  return NextResponse.json({ ok: true, users });
}
