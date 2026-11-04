/**
 * POST /api/photos/pair
 *
 * Creates a one-time photo-pairing token so a provider can pair their
 * phone to a chart by scanning a QR. The token is stored in Firestore
 * with the (tenant, client, appointment, chart) scope baked in. The
 * /photo-capture/[token] page (public — no session cookie) reads the
 * token to know what to upload to.
 *
 * Token TTL: 30 minutes. Created by a tenant_owner / tenant_provider
 * who's authenticated. Token usage is single-session but multi-photo
 * within that session.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { tenantCol } from "@/lib/tenant";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  client_id: z.string().trim().min(1).max(120),
  appointment_id: z.string().trim().max(120).nullable().optional(),
  chart_id: z.string().trim().max(120).nullable().optional(),
});

const TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.user.role !== "tenant_owner" && ctx.user.role !== "tenant_provider") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
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
  const data = parsed.data;

  // Verify the client belongs to this tenant
  const cliSnap = await tenantCol(ctx.tenant.id, "clients").doc(data.client_id).get();
  if (!cliSnap.exists) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  // 32-byte random token, base64url-encoded → 43 chars, unguessable.
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);

  // Store at the ROOT collection (not tenant-nested) so the public
  // /api/photos/pair-upload endpoint can look up the token by id without
  // knowing the tenant ahead of time. The token IS the auth — every
  // upload validates expiry + revocation, and the doc carries tenant_id
  // so all writes scope correctly.
  await db().collection("photo_pair_tokens").doc(token).set({
    tenant_id: ctx.tenant.id,
    client_id: data.client_id,
    appointment_id: data.appointment_id ?? null,
    chart_id: data.chart_id ?? null,
    created_by_user_id: ctx.user.firebaseUid,
    created_at: now(),
    expires_at: Timestamp.fromDate(expiresAt),
    revoked_at: null,
  });

  void writeAudit({
    action: "note.create",
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "photo.pair_token",
    targetId: token,
    after: { client_id: data.client_id, appointment_id: data.appointment_id ?? null },
  }).catch((err) => console.error("[photo-pair] audit", err));

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://aesthera.io";
  const captureUrl = `${baseUrl}/photo-capture/${token}`;

  return NextResponse.json({
    ok: true,
    token,
    capture_url: captureUrl,
    expires_at: expiresAt.toISOString(),
    ttl_ms: TTL_MS,
  });
}

/** DELETE /api/photos/pair?token=... — revoke an active token. */
export async function DELETE(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.user.role !== "tenant_owner" && ctx.user.role !== "tenant_provider") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const ref = db().collection("photo_pair_tokens").doc(token);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ ok: true, already: true });
  // Defense-in-depth: verify the token belongs to the actor's tenant
  const data = snap.data() as { tenant_id?: string };
  if (data.tenant_id !== ctx.tenant.id) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  await ref.update({ revoked_at: now() });
  return NextResponse.json({ ok: true });
}

// Suppress unused-import warning — tenantCol may still be used elsewhere
// in this file in future edits; kept to keep the surface stable.
void tenantCol;
