/**
 * One-shot: clean up duplicate Park City Main locations (and any
 * leftover audit log dupes) so the test tenant has a clean state.
 *
 * Usage: node scripts/cleanup-test-tenant.mjs <slug>
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const slug = process.argv[2] || "park-city-test";
initializeApp({ credential: applicationDefault(), projectId: "medspa-494718" });
const db = getFirestore();

const locSnap = await db.collection(`tenants/${slug}/locations`).get();
const dups = locSnap.docs.filter((d) => d.data().name === "Park City Main");
console.log(`Found ${dups.length} 'Park City Main' locations.`);
if (dups.length <= 1) {
  console.log("No cleanup needed.");
  process.exit(0);
}
// Keep the primary one; delete the rest
const primary = dups.find((d) => d.data().is_primary === true) ?? dups[0];
const toDelete = dups.filter((d) => d.id !== primary.id);
console.log(`Keeping ${primary.id} (primary=${primary.data().is_primary}).`);
for (const d of toDelete) {
  console.log(`Deleting ${d.id} (primary=${d.data().is_primary})...`);
  await d.ref.delete();
}
console.log("Done.");
