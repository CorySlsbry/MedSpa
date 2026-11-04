/**
 * One-shot: set a password for an existing Identity Platform user.
 *
 * Usage:
 *   node scripts/set-password.mjs <email> <password>
 *
 * Looks up the user by email; if found, calls updateUser({password}).
 * If the email is dot-insensitive (Gmail), tries a couple of variants
 * to find the actual account that exists.
 */

import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("usage: node scripts/set-password.mjs <email> <password>");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: "medspa-494718" });
const auth = getAuth();

// For Gmail dot-insensitivity: also try a few variants.
const candidates = new Set([email]);
const [local, domain] = email.split("@");
if (domain && domain.toLowerCase() === "gmail.com") {
  // periodless
  candidates.add(`${local.replace(/\./g, "")}@${domain}`);
  // swap "first.last" / "last.first"
  if (local.includes(".")) {
    const parts = local.split(".");
    if (parts.length === 2) candidates.add(`${parts[1]}.${parts[0]}@${domain}`);
  }
}

let found = null;
for (const candidate of candidates) {
  try {
    const user = await auth.getUserByEmail(candidate);
    found = user;
    console.log(`Found user: uid=${user.uid} email=${user.email}`);
    break;
  } catch (err) {
    if ((err && err.code) !== "auth/user-not-found") {
      console.error(`Lookup error for ${candidate}:`, err.message || err);
    }
  }
}

if (!found) {
  console.error(`No user found for any of: ${[...candidates].join(", ")}`);
  process.exit(2);
}

await auth.updateUser(found.uid, { password });
console.log(`Password updated for ${found.email} (uid=${found.uid}).`);
