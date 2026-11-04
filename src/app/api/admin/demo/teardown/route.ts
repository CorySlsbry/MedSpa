/**
 * DELETE /api/admin/demo/teardown
 *
 * Super-admin only. Removes the entire demo tenant: tenant doc + every
 * subcollection + the 6 Firebase Auth users + their UserDocs + all
 * platform-level lead docs that referenced the demo tenant. Idempotent.
 *
 * Subcollection delete uses Firestore Admin's bulk-writer recursiveDelete
 * helper — chunked deletes under the hood, safe for ~thousands of docs.
 */

import { NextResponse } from "next/server";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getSessionUser } from "@/lib/auth-server";
import { db } from "@/lib/firestore";
import { writeAudit } from "@/lib/audit";
import { DEMO_TENANT_SLUG, DEMO_EMAIL_DOMAIN } from "@/lib/demo-seed";

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

export async function DELETE() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  init();

  const tenantRef = db().collection("tenants").doc(DEMO_TENANT_SLUG);

  // 1. Tear down every subcollection under the tenant via recursiveDelete.
  await db().recursiveDelete(tenantRef).catch((err) => {
    console.error("[demo-teardown] recursiveDelete tenant", err);
  });

  // 2. Delete platform-level lead docs that came from the demo seed.
  //    They're tagged via raw_payload.demo=true.
  const leadsSnap = await db()
    .collection("leads")
    .where("raw_payload.demo", "==", true)
    .get()
    .catch(() => null);
  if (leadsSnap) {
    const batches: FirebaseFirestore.WriteBatch[] = [];
    let batch = db().batch();
    let count = 0;
    for (const d of leadsSnap.docs) {
      batch.delete(d.ref);
      count++;
      if (count % 400 === 0) {
        batches.push(batch);
        batch = db().batch();
      }
    }
    batches.push(batch);
    for (const b of batches) await b.commit().catch(() => {});
  }

  // 3. Delete the 6 demo Firebase Auth users + their UserDocs.
  const list = await getAuth().listUsers(1000);
  const demoUsers = list.users.filter((u) =>
    (u.email ?? "").toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN.toLowerCase()}`),
  );
  for (const u of demoUsers) {
    await getAuth().deleteUser(u.uid).catch((err) => {
      console.error(`[demo-teardown] delete user ${u.uid}`, err);
    });
    await db().collection("users").doc(u.uid).delete().catch(() => {});
  }

  void writeAudit({
    action: "admin.user_suspend",
    actorEmail: session.email,
    actorUserId: session.firebaseUid,
    targetType: "tenant.demo_teardown",
    targetId: DEMO_TENANT_SLUG,
    after: { deleted_users: demoUsers.length, deleted_leads: leadsSnap?.size ?? 0 },
  }).catch((err) => console.error("[demo-teardown] audit", err));

  return NextResponse.json({
    ok: true,
    deleted_users: demoUsers.length,
    deleted_leads: leadsSnap?.size ?? 0,
  });
}
