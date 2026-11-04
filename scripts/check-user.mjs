/**
 * One-shot: inspect an Identity Platform user's claims, status, and
 * find the matching tenant doc. Helpful for debugging sign-in.
 *
 * Usage: node scripts/check-user.mjs <email>
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const email = process.argv[2];
if (!email) {
  console.error("usage: node scripts/check-user.mjs <email>");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: "medspa-494718" });
const auth = getAuth();
const db = getFirestore();

const user = await auth.getUserByEmail(email);
console.log("User:");
console.log("  uid:", user.uid);
console.log("  email:", user.email);
console.log("  emailVerified:", user.emailVerified);
console.log("  disabled:", user.disabled);
console.log("  customClaims:", JSON.stringify(user.customClaims, null, 2));
console.log("  providerData:", user.providerData.map((p) => p.providerId).join(","));

const tenantId = user.customClaims?.tenant_id;
if (tenantId) {
  const tenantSnap = await db.collection("tenants").doc(tenantId).get();
  if (tenantSnap.exists) {
    const t = tenantSnap.data();
    console.log("\nTenant:");
    console.log("  id:", tenantId);
    console.log("  name:", t.name);
    console.log("  status:", t.subscription_status);
    console.log("  tier:", t.subscription_tier);
    console.log("  owner_email:", t.owner_email);
    console.log("  owner_user_id:", t.owner_user_id);
  } else {
    console.log("\nTenant doc with id", tenantId, "does NOT exist.");
  }
} else {
  console.log("\nNo tenant_id claim — user can't sign into a tenant portal.");
}
