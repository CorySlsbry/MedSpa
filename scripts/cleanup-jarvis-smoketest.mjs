/**
 * Remove the synthetic smoke-test rows from the Jarvis ingest endpoint.
 * Wipes contacts + leads + companies + workflow_enrollments tagged
 * jarvis-smoke-test.
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault(), projectId: "medspa-494718" });
const db = getFirestore();

async function deleteByQuery(label, query) {
  const snap = await query.get();
  console.log(`[${label}] found ${snap.size}`);
  for (const d of snap.docs) {
    await d.ref.delete();
  }
}

await deleteByQuery(
  "contacts(jarvis-smoke-test)",
  db.collection("contacts").where("tags", "array-contains", "jarvis-smoke-test"),
);
await deleteByQuery(
  "leads(by source jarvis_apollo + smoketest emails)",
  db
    .collection("leads")
    .where("contact.email", "in", [
      "person1@example.com",
      "person2@example.com",
    ]),
);
await deleteByQuery(
  "companies(Smoke Test)",
  db.collection("companies").where("name_lower", "in", [
    "smoke test med spa",
    "second smoke aesthetics",
  ]),
);
await deleteByQuery(
  "workflow_enrollments(smoketest)",
  db
    .collection("workflow_enrollments")
    .where("contact_email", "in", [
      "person1@example.com",
      "person2@example.com",
    ]),
);
console.log("Done.");
