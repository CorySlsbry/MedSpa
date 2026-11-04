/**
 * Firestore admin client — single source of truth for the CRM data layer.
 *
 * Cloud Run uses the runtime service account's IAM identity (free, no static
 * credentials). Local dev uses `gcloud auth application-default login`.
 *
 * Security model: all writes happen here on the server via the Admin SDK,
 * which bypasses security rules. Security rules in firestore/security-rules
 * are still configured as defense-in-depth — they apply if anyone ever tries
 * to talk to Firestore from the client SDK directly.
 */

import {
  cert,
  getApps,
  initializeApp,
  applicationDefault,
} from "firebase-admin/app";
import {
  getFirestore,
  Firestore,
  Timestamp,
  FieldValue,
  type Transaction,
} from "firebase-admin/firestore";

let firestoreInstance: Firestore | null = null;

function init() {
  if (getApps().length > 0) return;
  const saB64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saB64) {
    try {
      const parsed = JSON.parse(Buffer.from(saB64, "base64").toString("utf8"));
      initializeApp({ credential: cert(parsed) });
      return;
    } catch {
      /* fallthrough */
    }
  }
  initializeApp({ credential: applicationDefault() });
}

export function db(): Firestore {
  if (firestoreInstance) return firestoreInstance;
  init();
  firestoreInstance = getFirestore();
  // Set ignoreUndefinedProperties so we can pass `undefined` in writes
  // without errors (Firestore rejects undefined by default).
  // Wrapped in try/catch because Next.js dev hot-reloads re-evaluate this
  // module while the underlying SDK Firestore instance is preserved —
  // calling settings() a second time on the same instance throws "already
  // been initialized." In production there's no reload so the first call
  // succeeds. Either way, the configured behavior persists.
  try {
    firestoreInstance.settings({ ignoreUndefinedProperties: true });
  } catch (err) {
    if (!String(err).includes("already been initialized")) throw err;
  }
  return firestoreInstance;
}

/** Run an atomic Firestore transaction. */
export function runTx<T>(fn: (trx: Transaction) => Promise<T>): Promise<T> {
  return db().runTransaction(fn);
}

/** Convert a Firestore Timestamp (or undefined) to a JS Date. */
export function toDate(ts: Timestamp | null | undefined): Date | null {
  if (!ts) return null;
  return ts.toDate();
}

/** Convenience export for callers writing server timestamps. */
export const now = FieldValue.serverTimestamp;

/** Health-check helper. Returns true if Firestore is reachable. */
export async function pingFirestore(): Promise<boolean> {
  try {
    // A trivial read against a known meta doc. Doesn't have to exist.
    await db().collection("_meta").doc("health").get();
    return true;
  } catch (err) {
    console.error("[firestore] ping failed", err);
    return false;
  }
}
