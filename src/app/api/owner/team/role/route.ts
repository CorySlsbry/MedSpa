/**
 * POST /api/owner/team/role — change a user's role within this tenant.
 *
 * Authorization rules:
 *   - Owner can change anyone's role within the tenant (including to/from
 *     owner — the OG owner is just a regular user with the owner role).
 *   - Manager can change roles to/from manager, provider, front_desk, or
 *     client — but cannot promote anyone to owner, and cannot change a
 *     current owner's role.
 *   - Provider can promote a client to front_desk. Cannot touch any other
 *     role transition.
 *
 * Audited. Rejects super_admin claims (those live in a separate auth
 * universe and tenant calls cannot set them).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContextApi } from "@/lib/tenant-context";
import { setTenantClaims } from "@/lib/tenant";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { db, now } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import type { UserRole } from "@/lib/firestore-types";

function initFb() {
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  targetUserId: z.string().trim().min(1).max(120),
  newRole: z.enum([
    "tenant_owner",
    "tenant_manager",
    "tenant_provider",
    "tenant_front_desk",
    "tenant_client",
  ]),
});

type Actor = "tenant_owner" | "tenant_manager" | "tenant_provider";
const TENANT_ROLES_BY_PRIVILEGE: UserRole[] = [
  "tenant_owner",
  "tenant_manager",
  "tenant_provider",
  "tenant_front_desk",
  "tenant_client",
];

/** Whether `actor` is allowed to transition `target` from currentRole → newRole. */
function canChange(actor: Actor, currentRole: UserRole, newRole: UserRole): { ok: true } | { ok: false; reason: string } {
  // Super-admin claims never appear here — they're not in TenantRole shape.
  if (actor === "tenant_owner") {
    return { ok: true }; // owners can do everything inside their tenant
  }
  if (actor === "tenant_manager") {
    if (currentRole === "tenant_owner") return { ok: false, reason: "Only the owner can change another owner's role." };
    if (newRole === "tenant_owner") return { ok: false, reason: "Only the owner can promote someone to owner." };
    return { ok: true };
  }
  // tenant_provider — narrow allowance: promote a client to front_desk
  if (currentRole === "tenant_client" && newRole === "tenant_front_desk") return { ok: true };
  return { ok: false, reason: "Providers can only promote clients to front-desk staff." };
}

export async function POST(req: Request) {
  const ctx = await requireTenantContextApi();
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  const actorRole = ctx.user.role;
  if (
    actorRole !== "tenant_owner" &&
    actorRole !== "tenant_manager" &&
    actorRole !== "tenant_provider"
  ) {
    return NextResponse.json(
      { error: "Only owners, managers, and providers can change roles." },
      { status: 403 },
    );
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

  // Source-of-truth on tenant membership = Firebase Auth custom claims.
  initFb();
  let target;
  try {
    target = await getAuth().getUser(parsed.data.targetUserId);
  } catch {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }
  const targetClaims = (target.customClaims ?? {}) as { tenant_id?: string; role?: string };
  if (targetClaims.tenant_id !== ctx.user.tenantId) {
    return NextResponse.json({ error: "User is not part of this tenant." }, { status: 403 });
  }
  if (targetClaims.role === "super_admin") {
    return NextResponse.json({ error: "Cannot change super-admin claims from here." }, { status: 403 });
  }
  const targetRole = (targetClaims.role ?? "tenant_client") as UserRole;

  const allowed = canChange(actorRole as Actor, targetRole, parsed.data.newRole);
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.reason }, { status: 403 });
  }

  // Apply: update Firebase custom claims + Firestore user doc (best-effort
  // — the doc may not exist yet for freshly-invited staff).
  try {
    await setTenantClaims(parsed.data.targetUserId, ctx.user.tenantId!, parsed.data.newRole);
    await db()
      .collection("users")
      .doc(parsed.data.targetUserId)
      .set({ role: parsed.data.newRole, updated_at: now() }, { merge: true });
  } catch (err) {
    console.error("[owner-team-role] failed to apply role change", err);
    return NextResponse.json(
      { error: "Couldn't apply the role change. Try again in a moment." },
      { status: 500 },
    );
  }

  void writeAudit({
    action: "admin.user_create", // closest existing action — the enum doesn't yet have role.change
    actorEmail: ctx.user.email,
    actorUserId: ctx.user.firebaseUid,
    targetType: "user.role",
    targetId: parsed.data.targetUserId,
    before: { role: targetRole },
    after: { role: parsed.data.newRole, tenant_id: ctx.user.tenantId },
  }).catch((err) => console.error("[owner-team-role] audit", err));

  return NextResponse.json({
    ok: true,
    targetUserId: parsed.data.targetUserId,
    newRole: parsed.data.newRole,
    note:
      "The change applies on the user's next sign-in (or after their current session refreshes ~1 hour).",
  });
}

// PRIVILEGE_ORDER intentionally not exported — Next.js route files only
// allow specific exports (HTTP methods + dynamic config). The order list
// is internal to this file.
void TENANT_ROLES_BY_PRIVILEGE;
