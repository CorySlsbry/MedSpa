// One-shot: create or update the super-admin Firebase user with a password
// and set the role=super_admin custom claim.
//
// Usage:
//   SEED_EMAIL=you@example.com SEED_PASSWORD='...' node scripts/seed-superadmin.mjs
//
// Reads credentials from Application Default Credentials (gcloud auth
// application-default login OR Cloud Run runtime SA). Never logs the password.

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const email = process.env.SEED_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_PASSWORD;

if (!email || !password) {
  console.error("Set SEED_EMAIL and SEED_PASSWORD env vars.");
  process.exit(1);
}

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GOOGLE_CLOUD_PROJECT || "medspa-494718",
});
const auth = getAuth();

try {
  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`User exists (${user.uid}) — updating password + verified flag`);
    await auth.updateUser(user.uid, { password, emailVerified: true });
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      console.log(`Creating new user ${email}`);
      user = await auth.createUser({ email, password, emailVerified: true });
      console.log(`Created uid ${user.uid}`);
    } else {
      throw err;
    }
  }
  await auth.setCustomUserClaims(user.uid, { role: "super_admin" });
  console.log(`✓ Super-admin set up: ${email} (uid ${user.uid}) with role=super_admin`);
} catch (err) {
  console.error("Failed:", err.message || err);
  process.exit(1);
}
